import logging
from datetime import datetime
from typing import List, Optional
import uuid

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .models import (
    OptimizationRequest,
    OptimizationResult,
    JobResponse,
    JobStatusResponse,
    JobStatus as JobStatusEnum,
    EvaluationRequest,
    SuggestRequest,
    SuggestResponse,
    ErrorResponse,
)
from .optuna_service import optuna_service
from .tasks import job_manager

logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="Ax Optimizer Service",
    description="HTTP service for Ax LLM optimization using Optuna",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


@app.post("/optimize", response_model=JobResponse)
async def create_optimization_job(request: OptimizationRequest):
    """Create a new optimization job."""
    try:
        # Generate job ID and study name
        job_id = str(uuid.uuid4())
        study_name = request.study_name or f"study_{uuid.uuid4().hex[:8]}"
        
        # Create study
        actual_study_name = optuna_service.create_study(request)
        
        # Create job record
        await job_manager.create_job(job_id, request, actual_study_name)
        
        # Enqueue the optimization task
        await job_manager.enqueue_optimization(job_id, request, actual_study_name)
        
        return JobResponse(
            job_id=job_id,
            study_name=actual_study_name,
            status=JobStatusEnum.PENDING,
            created_at=datetime.utcnow()
        )
        
    except Exception as e:
        logger.error(f"Failed to create optimization job: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job_status(job_id: str):
    """Get job status and results."""
    try:
        job_data = await job_manager.get_job(job_id)
        
        if not job_data:
            raise HTTPException(status_code=404, detail="Job not found")
        
        # Parse timestamps
        created_at = datetime.fromisoformat(job_data["created_at"])
        started_at = None
        completed_at = None
        
        if job_data.get("started_at"):
            started_at = datetime.fromisoformat(job_data["started_at"])
        if job_data.get("completed_at"):
            completed_at = datetime.fromisoformat(job_data["completed_at"])
        
        # Get optimization result if completed
        result = None
        if job_data["status"] == JobStatusEnum.COMPLETED.value:
            result = optuna_service.get_optimization_result(job_data["study_name"])
        
        return JobStatusResponse(
            job_id=job_id,
            study_name=job_data["study_name"],
            status=JobStatusEnum(job_data["status"]),
            created_at=created_at,
            started_at=started_at,
            completed_at=completed_at,
            error=job_data.get("error"),
            result=result
        )
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to get job status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/jobs/{job_id}")
async def cancel_job(job_id: str):
    """Cancel a job."""
    try:
        job_data = await job_manager.get_job(job_id)
        
        if not job_data:
            raise HTTPException(status_code=404, detail="Job not found")
        
        if job_data["status"] in [JobStatusEnum.COMPLETED.value, JobStatusEnum.FAILED.value]:
            raise HTTPException(status_code=400, detail="Cannot cancel completed job")
        
        # Update job status
        await job_manager.update_job_status(job_id, JobStatusEnum.CANCELLED)
        
        return {"message": "Job cancelled successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to cancel job: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/jobs", response_model=List[JobStatusResponse])
async def list_jobs(limit: int = 100):
    """List recent jobs."""
    try:
        jobs_data = await job_manager.list_jobs(limit)
        jobs = []
        
        for job_data in jobs_data:
            created_at = datetime.fromisoformat(job_data["created_at"])
            started_at = None
            completed_at = None
            
            if job_data.get("started_at"):
                started_at = datetime.fromisoformat(job_data["started_at"])
            if job_data.get("completed_at"):
                completed_at = datetime.fromisoformat(job_data["completed_at"])
            
            jobs.append(JobStatusResponse(
                job_id=job_data["job_id"],
                study_name=job_data["study_name"],
                status=JobStatusEnum(job_data["status"]),
                created_at=created_at,
                started_at=started_at,
                completed_at=completed_at,
                error=job_data.get("error")
            ))
        
        return jobs
        
    except Exception as e:
        logger.error(f"Failed to list jobs: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/studies/{study_name}/suggest", response_model=SuggestResponse)
async def suggest_parameters(study_name: str):
    """Get suggested parameters for the next trial."""
    try:
        suggestion = optuna_service.suggest_parameters(study_name)
        
        if not suggestion:
            raise HTTPException(status_code=404, detail="Study not found")
        
        return SuggestResponse(
            trial_number=suggestion["trial_number"],
            params=suggestion["params"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to suggest parameters: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/studies/{study_name}/evaluate")
async def evaluate_trial(study_name: str, request: EvaluationRequest):
    """Report trial evaluation result."""
    try:
        success = optuna_service.report_trial_result(
            study_name=request.study_name,
            trial_number=request.trial_number,
            value=request.value,
            intermediate_values=request.intermediate_values
        )
        
        if not success:
            raise HTTPException(status_code=400, detail="Failed to report trial result")
        
        return {"message": "Trial result reported successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to evaluate trial: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/studies/{study_name}/results", response_model=OptimizationResult)
async def get_study_results(study_name: str):
    """Get optimization results for a study."""
    try:
        result = optuna_service.get_optimization_result(study_name)
        
        if not result:
            raise HTTPException(status_code=404, detail="Study not found")
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get study results: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/studies/{study_name}")
async def delete_study(study_name: str):
    """Delete a study."""
    try:
        success = optuna_service.delete_study(study_name)
        
        if not success:
            raise HTTPException(status_code=404, detail="Study not found")
        
        return {"message": "Study deleted successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete study: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/studies", response_model=List[str])
async def list_studies():
    """List all studies."""
    try:
        studies = optuna_service.list_studies()
        return studies
        
    except Exception as e:
        logger.error(f"Failed to list studies: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Error handlers
@app.exception_handler(ValueError)
async def value_error_handler(request, exc):
    return HTTPException(status_code=400, detail=str(exc))


@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    logger.error(f"Unexpected error: {exc}")
    return HTTPException(status_code=500, detail="Internal server error")