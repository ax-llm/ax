import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class Settings:
    """Application settings with optional Redis support."""
    
    # Server settings
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"
    
    # Queue settings (Redis optional - defaults to in-memory)
    USE_MEMORY_QUEUE: bool = os.getenv("USE_MEMORY_QUEUE", "true").lower() == "true"
    REDIS_URL: Optional[str] = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    
    # Database settings (optional persistence)
    DATABASE_URL: Optional[str] = os.getenv("DATABASE_URL")
    USE_MEMORY_STORAGE: bool = os.getenv("USE_MEMORY_STORAGE", "true").lower() == "true"
    
    # Optimization settings
    MAX_TRIALS_PER_STUDY: int = int(os.getenv("MAX_TRIALS_PER_STUDY", "1000"))
    DEFAULT_TIMEOUT_SECONDS: int = int(os.getenv("DEFAULT_TIMEOUT_SECONDS", "3600"))  # 1 hour
    
    # Job settings
    MAX_CONCURRENT_JOBS: int = int(os.getenv("MAX_CONCURRENT_JOBS", "10"))
    
    # Logging
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    
    def __init__(self):
        """Initialize settings and check Redis availability."""
        # Auto-detect if Redis should be used
        if not self.USE_MEMORY_QUEUE and self.REDIS_URL:
            try:
                import redis
                r = redis.from_url(self.REDIS_URL)
                r.ping()
                logger.info("Redis is available and will be used for task queue")
            except Exception as e:
                logger.warning(f"Redis not available ({e}), falling back to in-memory queue")
                self.USE_MEMORY_QUEUE = True
                self.REDIS_URL = None
        
        if self.USE_MEMORY_QUEUE:
            logger.info("Using in-memory task queue (Redis not required)")
    
    @property
    def is_redis_available(self) -> bool:
        """Check if Redis is configured and available."""
        return bool(self.REDIS_URL and not self.USE_MEMORY_QUEUE)


settings = Settings()