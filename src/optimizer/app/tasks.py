import asyncio
import logging
from datetime import datetime
from typing import Dict, Any, Optional, List
import uuid

from arq import create_pool
from arq.connections import RedisSettings
import redis.asyncio as redis

from .config import settings
from .models import OptimizationRequest, JobStatus as JobStatusEnum
from .optuna_service import optuna_service

logger = logging.getLogger(__name__)


class JobManager:
    """Manager for tracking optimization jobs."""
    
    def __init__(self):
        self._redis: Optional[redis.Redis] = None
        self._pool = None
    
    async def get_redis(self) -> redis.Redis:
        """Get Redis connection."""
        if self._redis is None:
            self._redis = redis.from_url(settings.REDIS_URL)
        return self._redis
    
    async def get_arq_pool(self):
        """Get ARQ connection pool."""
        if self._pool is None:
            redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
            self._pool = await create_pool(redis_settings)
        return self._pool
    
    async def create_job(self, job_id: str, request: OptimizationRequest, study_name: str) -> Dict[str, Any]:
        """Create a new optimization job."""
        job_data = {
            "job_id": job_id,
            "study_name": study_name,
            "status": JobStatusEnum.PENDING.value,
            "created_at": datetime.utcnow().isoformat(),
            "request": request.dict(),
        }
        
        redis_client = await self.get_redis()
        await redis_client.hset(f"job:{job_id}", mapping={
            k: str(v) if not isinstance(v, str) else v 
            for k, v in job_data.items()
        })
        
        return job_data
    
    async def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Get job status and data."""
        redis_client = await self.get_redis()
        job_data = await redis_client.hgetall(f"job:{job_id}")
        
        if not job_data:
            return None
        
        # Convert bytes to strings and parse JSON fields
        result = {}
        for k, v in job_data.items():
            k = k.decode() if isinstance(k, bytes) else k
            v = v.decode() if isinstance(v, bytes) else v
            result[k] = v
        
        return result
    
    async def update_job_status(self, job_id: str, status: JobStatusEnum, **kwargs) -> bool:
        """Update job status."""
        redis_client = await self.get_redis()
        
        update_data = {"status": status.value}
        
        if status == JobStatusEnum.RUNNING:
            update_data["started_at"] = datetime.utcnow().isoformat()
        elif status in [JobStatusEnum.COMPLETED, JobStatusEnum.FAILED, JobStatusEnum.CANCELLED]:
            update_data["completed_at"] = datetime.utcnow().isoformat()
        
        # Add any additional fields
        update_data.update(kwargs)
        
        await redis_client.hset(f"job:{job_id}", mapping=update_data)
        return True
    
    async def enqueue_optimization(self, job_id: str, request: OptimizationRequest, study_name: str) -> str:
        """Enqueue optimization job."""
        pool = await self.get_arq_pool()
        
        job = await pool.enqueue_job(
            'run_optimization_task',
            job_id,
            request.dict(),
            study_name
        )
        
        return job.job_id
    
    async def list_jobs(self, limit: int = 100) -> List[Dict[str, Any]]:
        """List recent jobs."""
        redis_client = await self.get_redis()
        
        # Get all job keys
        keys = await redis_client.keys("job:*")
        jobs = []
        
        for key in keys[:limit]:
            job_data = await redis_client.hgetall(key)
            if job_data:
                result = {}
                for k, v in job_data.items():
                    k = k.decode() if isinstance(k, bytes) else k
                    v = v.decode() if isinstance(v, bytes) else v
                    result[k] = v
                jobs.append(result)
        
        # Sort by created_at descending
        jobs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return jobs


# Global job manager instance
job_manager = JobManager()


async def run_optimization_task(ctx, job_id: str, request_data: Dict[str, Any], study_name: str):
    """ARQ task to run optimization."""
    logger.info(f"Starting optimization job {job_id} for study {study_name}")
    
    try:
        # Update job status to running
        await job_manager.update_job_status(job_id, JobStatusEnum.RUNNING)
        
        # Parse request
        request = OptimizationRequest(**request_data)
        
        # Create or get study
        try:
            actual_study_name = optuna_service.create_study(request)
        except Exception as e:
            if "already exists" in str(e):
                actual_study_name = study_name
            else:
                raise
        
        # Run optimization - this is a simplified version
        # In practice, this would coordinate with external evaluation
        result = optuna_service.get_optimization_result(actual_study_name)
        
        # Update job status to completed
        await job_manager.update_job_status(
            job_id, 
            JobStatusEnum.COMPLETED,
            result=result.dict() if result else None
        )
        
        logger.info(f"Completed optimization job {job_id}")
        
    except Exception as e:
        logger.error(f"Optimization job {job_id} failed: {e}")
        await job_manager.update_job_status(
            job_id, 
            JobStatusEnum.FAILED,
            error=str(e)
        )
        raise


# ARQ worker settings
class WorkerSettings:
    functions = [run_optimization_task]
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    job_timeout = settings.DEFAULT_TIMEOUT_SECONDS
    max_jobs = settings.MAX_CONCURRENT_JOBS