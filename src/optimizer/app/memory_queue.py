"""
In-memory task queue implementation for Redis-less deployments.

This module provides a simple in-memory alternative to Redis/ARQ
for environments where Redis is not available or not desired.
"""

import asyncio
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Callable
from concurrent.futures import ThreadPoolExecutor
import threading

from .models import JobStatus as JobStatusEnum

logger = logging.getLogger(__name__)


class InMemoryTaskQueue:
    """Simple in-memory task queue for optimization jobs."""
    
    def __init__(self, max_workers: int = 4):
        """Initialize the in-memory task queue."""
        self.tasks: Dict[str, Dict[str, Any]] = {}
        self.results: Dict[str, Any] = {}
        self.executor = ThreadPoolExecutor(max_workers=max_workers)
        self.lock = threading.Lock()
        self.running_tasks: Dict[str, asyncio.Task] = {}
        logger.info(f"Initialized in-memory task queue with {max_workers} workers")
    
    async def enqueue(
        self,
        task_id: str,
        func: Callable,
        *args,
        **kwargs
    ) -> str:
        """
        Enqueue a task for execution.
        
        Args:
            task_id: Unique task identifier
            func: Function to execute
            args: Positional arguments for the function
            kwargs: Keyword arguments for the function
        
        Returns:
            Task ID
        """
        with self.lock:
            self.tasks[task_id] = {
                "id": task_id,
                "func": func,
                "args": args,
                "kwargs": kwargs,
                "status": "pending",
                "created_at": datetime.utcnow(),
                "started_at": None,
                "completed_at": None,
                "error": None
            }
        
        # Start task execution in background
        asyncio.create_task(self._execute_task(task_id))
        
        logger.info(f"Enqueued task {task_id}")
        return task_id
    
    async def _execute_task(self, task_id: str) -> None:
        """Execute a task in the background."""
        task = self.tasks.get(task_id)
        if not task:
            logger.error(f"Task {task_id} not found")
            return
        
        try:
            # Update status to running
            with self.lock:
                task["status"] = "running"
                task["started_at"] = datetime.utcnow()
            
            logger.info(f"Starting task {task_id}")
            
            # Execute the function
            func = task["func"]
            args = task["args"]
            kwargs = task["kwargs"]
            
            # If the function is async, await it
            if asyncio.iscoroutinefunction(func):
                result = await func(*args, **kwargs)
            else:
                # Run sync function in thread pool
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(
                    self.executor, func, *args, **kwargs
                )
            
            # Store result
            with self.lock:
                self.results[task_id] = result
                task["status"] = "completed"
                task["completed_at"] = datetime.utcnow()
            
            logger.info(f"Completed task {task_id}")
            
        except Exception as e:
            logger.error(f"Task {task_id} failed: {e}")
            with self.lock:
                task["status"] = "failed"
                task["error"] = str(e)
                task["completed_at"] = datetime.utcnow()
    
    async def get_task_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Get the status of a task."""
        with self.lock:
            task = self.tasks.get(task_id)
            if not task:
                return None
            
            # Create a copy without the function reference
            status = {
                "id": task["id"],
                "status": task["status"],
                "created_at": task["created_at"],
                "started_at": task["started_at"],
                "completed_at": task["completed_at"],
                "error": task["error"]
            }
            
            # Include result if completed
            if task["status"] == "completed" and task_id in self.results:
                status["result"] = self.results[task_id]
            
            return status
    
    async def cancel_task(self, task_id: str) -> bool:
        """Cancel a pending or running task."""
        with self.lock:
            task = self.tasks.get(task_id)
            if not task:
                return False
            
            if task["status"] in ["completed", "failed", "cancelled"]:
                return False
            
            task["status"] = "cancelled"
            task["completed_at"] = datetime.utcnow()
            
            # Try to cancel the asyncio task if it's running
            if task_id in self.running_tasks:
                self.running_tasks[task_id].cancel()
            
            logger.info(f"Cancelled task {task_id}")
            return True
    
    async def list_tasks(
        self,
        limit: int = 100,
        status: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """List tasks with optional filtering."""
        with self.lock:
            tasks = list(self.tasks.values())
            
            # Filter by status if specified
            if status:
                tasks = [t for t in tasks if t["status"] == status]
            
            # Sort by created_at descending
            tasks.sort(key=lambda t: t["created_at"], reverse=True)
            
            # Apply limit
            tasks = tasks[:limit]
            
            # Return without function references
            return [
                {
                    "id": t["id"],
                    "status": t["status"],
                    "created_at": t["created_at"],
                    "started_at": t["started_at"],
                    "completed_at": t["completed_at"],
                    "error": t["error"]
                }
                for t in tasks
            ]
    
    def cleanup(self) -> None:
        """Clean up resources."""
        self.executor.shutdown(wait=False)
        logger.info("Cleaned up in-memory task queue")


class InMemoryJobManager:
    """In-memory job manager for optimization jobs."""
    
    def __init__(self, task_queue: InMemoryTaskQueue):
        """Initialize the job manager."""
        self.task_queue = task_queue
        self.jobs: Dict[str, Dict[str, Any]] = {}
        self.lock = threading.Lock()
    
    async def create_job(
        self,
        job_id: str,
        request: Any,
        study_name: str
    ) -> None:
        """Create a new job record."""
        with self.lock:
            self.jobs[job_id] = {
                "job_id": job_id,
                "study_name": study_name,
                "request": request,
                "status": JobStatusEnum.PENDING.value,
                "created_at": datetime.utcnow().isoformat(),
                "started_at": None,
                "completed_at": None,
                "error": None
            }
        
        logger.info(f"Created job {job_id} for study {study_name}")
    
    async def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Get job information."""
        with self.lock:
            job = self.jobs.get(job_id)
            if job:
                # Check task status
                task_status = await self.task_queue.get_task_status(job_id)
                if task_status:
                    # Update job status based on task status
                    if task_status["status"] == "running":
                        job["status"] = JobStatusEnum.RUNNING.value
                        job["started_at"] = task_status["started_at"].isoformat()
                    elif task_status["status"] == "completed":
                        job["status"] = JobStatusEnum.COMPLETED.value
                        job["completed_at"] = task_status["completed_at"].isoformat()
                    elif task_status["status"] == "failed":
                        job["status"] = JobStatusEnum.FAILED.value
                        job["error"] = task_status["error"]
                        job["completed_at"] = task_status["completed_at"].isoformat()
                    elif task_status["status"] == "cancelled":
                        job["status"] = JobStatusEnum.CANCELLED.value
                        job["completed_at"] = task_status["completed_at"].isoformat()
            
            return job
    
    async def update_job_status(
        self,
        job_id: str,
        status: JobStatusEnum,
        error: Optional[str] = None
    ) -> None:
        """Update job status."""
        with self.lock:
            job = self.jobs.get(job_id)
            if job:
                job["status"] = status.value
                if status == JobStatusEnum.RUNNING:
                    job["started_at"] = datetime.utcnow().isoformat()
                elif status in [JobStatusEnum.COMPLETED, JobStatusEnum.FAILED, JobStatusEnum.CANCELLED]:
                    job["completed_at"] = datetime.utcnow().isoformat()
                if error:
                    job["error"] = error
        
        logger.info(f"Updated job {job_id} status to {status.value}")
    
    async def list_jobs(self, limit: int = 100) -> List[Dict[str, Any]]:
        """List recent jobs."""
        with self.lock:
            jobs = list(self.jobs.values())
            # Sort by created_at descending
            jobs.sort(key=lambda j: j["created_at"], reverse=True)
            return jobs[:limit]
    
    async def enqueue_optimization(
        self,
        job_id: str,
        request: Any,
        study_name: str
    ) -> None:
        """Enqueue an optimization task."""
        # Import here to avoid circular dependency
        from .tasks import run_optimization_task
        
        # Enqueue the task
        await self.task_queue.enqueue(
            job_id,
            run_optimization_task,
            job_id,
            request,
            study_name
        )
        
        logger.info(f"Enqueued optimization task for job {job_id}")


# Global instances (initialized on first use)
_memory_queue: Optional[InMemoryTaskQueue] = None
_memory_job_manager: Optional[InMemoryJobManager] = None


def get_memory_queue() -> InMemoryTaskQueue:
    """Get or create the global in-memory task queue."""
    global _memory_queue
    if _memory_queue is None:
        _memory_queue = InMemoryTaskQueue()
    return _memory_queue


def get_memory_job_manager() -> InMemoryJobManager:
    """Get or create the global in-memory job manager."""
    global _memory_job_manager
    if _memory_job_manager is None:
        _memory_job_manager = InMemoryJobManager(get_memory_queue())
    return _memory_job_manager