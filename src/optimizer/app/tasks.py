import asyncio
import logging
from datetime import datetime
from typing import Dict, Any, Optional, List
import uuid

from .config import settings
from .models import OptimizationRequest, JobStatus as JobStatusEnum
from .optuna_service import optuna_service

logger = logging.getLogger(__name__)

# Conditional imports based on Redis availability
if settings.is_redis_available:
    try:
        from arq import create_pool
        from arq.connections import RedisSettings
        import redis.asyncio as redis
        REDIS_AVAILABLE = True
    except ImportError:
        logger.warning("Redis libraries not available, using in-memory queue")
        REDIS_AVAILABLE = False
else:
    REDIS_AVAILABLE = False

# Import in-memory alternatives
if not REDIS_AVAILABLE or settings.USE_MEMORY_QUEUE:
    from .memory_queue import get_memory_job_manager, get_memory_queue


class JobManager:
    """Manager for tracking optimization jobs with Redis or in-memory fallback."""
    
    def __init__(self):
        self._redis: Optional[Any] = None
        self._pool = None
        self.use_memory = not REDIS_AVAILABLE or settings.USE_MEMORY_QUEUE
        
        if self.use_memory:
            logger.info("Using in-memory job manager")
        else:
            logger.info("Using Redis-based job manager")
    
    async def get_redis(self):
        """Get Redis connection (if available)."""
        if self.use_memory:
            raise RuntimeError("Redis not available, using in-memory storage")
        
        if self._redis is None:
            import redis.asyncio as redis
            self._redis = redis.from_url(settings.REDIS_URL)
        return self._redis
    
    async def get_arq_pool(self):
        """Get ARQ connection pool (if available)."""
        if self.use_memory:
            raise RuntimeError("ARQ not available, using in-memory queue")
        
        if self._pool is None:
            from arq import create_pool
            from arq.connections import RedisSettings
            redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
            self._pool = await create_pool(redis_settings)
        return self._pool
    
    async def create_job(self, job_id: str, request: OptimizationRequest, study_name: str) -> Dict[str, Any]:
        """Create a new optimization job."""
        if self.use_memory:
            # Use in-memory manager
            manager = get_memory_job_manager()
            await manager.create_job(job_id, request, study_name)
            return {
                "job_id": job_id,
                "study_name": study_name,
                "status": JobStatusEnum.PENDING.value,
                "created_at": datetime.utcnow().isoformat(),
            }
        
        # Use Redis
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
        if self.use_memory:
            # Use in-memory manager
            manager = get_memory_job_manager()
            return await manager.get_job(job_id)
        
        # Use Redis
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
        if self.use_memory:
            # Use in-memory manager
            manager = get_memory_job_manager()
            await manager.update_job_status(job_id, status, kwargs.get("error"))
            return True
        
        # Use Redis
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
        if self.use_memory:
            # Use in-memory queue
            manager = get_memory_job_manager()
            await manager.enqueue_optimization(job_id, request, study_name)
            return job_id
        
        # Use ARQ
        pool = await self.get_arq_pool()
        
        job = await pool.enqueue_job(
            'run_optimization_task',
            job_id,
            request.dict(),
            study_name
        )
        
        logger.info(f"Enqueued optimization job {job_id} with ARQ job {job.job_id}")
        return job.job_id
    
    async def list_jobs(self, limit: int = 100) -> List[Dict[str, Any]]:
        """List recent jobs."""
        if self.use_memory:
            # Use in-memory manager
            manager = get_memory_job_manager()
            return await manager.list_jobs(limit)
        
        # Use Redis
        redis_client = await self.get_redis()
        
        # Get all job keys
        keys = await redis_client.keys("job:*")
        jobs = []
        
        for key in keys[:limit]:  # Limit the number of jobs
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
        
        return jobs[:limit]


# Global job manager instance
job_manager = JobManager()


async def run_optimization_task(job_id: str, request_dict: Dict[str, Any], study_name: str):
    """
    Background task to run optimization.
    This function can be called by both ARQ and in-memory queue.
    """
    logger.info(f"Starting optimization task for job {job_id}")
    
    try:
        # Update job status to running
        await job_manager.update_job_status(job_id, JobStatusEnum.RUNNING)
        
        # Recreate request object
        request = OptimizationRequest(**request_dict)
        
        # Run optimization trials
        for trial_num in range(request.n_trials):
            # Check if job was cancelled
            job_data = await job_manager.get_job(job_id)
            if job_data and job_data.get("status") == JobStatusEnum.CANCELLED.value:
                logger.info(f"Job {job_id} was cancelled")
                break
            
            # Get parameter suggestions
            suggestion = optuna_service.suggest_parameters(study_name)
            if not suggestion:
                logger.error(f"Failed to get suggestions for study {study_name}")
                break
            
            # Simulate evaluation (in real use, this would call the actual model)
            # For now, we'll use a simple random evaluation
            import random
            value = random.random()
            
            # Report result
            optuna_service.report_trial_result(
                study_name=study_name,
                trial_number=suggestion["trial_number"],
                value=value
            )
            
            logger.info(f"Trial {trial_num + 1}/{request.n_trials} completed with value {value}")
            
            # Small delay to prevent overwhelming the system
            await asyncio.sleep(0.1)
        
        # Update job status to completed
        await job_manager.update_job_status(job_id, JobStatusEnum.COMPLETED)
        
        logger.info(f"Optimization task completed for job {job_id}")
        
    except Exception as e:
        logger.error(f"Optimization task failed for job {job_id}: {e}")
        await job_manager.update_job_status(
            job_id, 
            JobStatusEnum.FAILED,
            error=str(e)
        )
        raise


# Worker settings for ARQ (only used if Redis is available)
if REDIS_AVAILABLE and not settings.USE_MEMORY_QUEUE:
    class WorkerSettings:
        """Settings for ARQ worker."""
        redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
        functions = [run_optimization_task]
        max_jobs = settings.MAX_CONCURRENT_JOBS
else:
    # Dummy WorkerSettings for when Redis is not available
    class WorkerSettings:
        """Placeholder settings when Redis is not available."""
        pass