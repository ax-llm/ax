import os
from typing import Optional


class Settings:
    """Application settings."""
    
    # Server settings
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"
    
    # Redis settings for ARQ
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    
    # Database settings (optional persistence)
    DATABASE_URL: Optional[str] = os.getenv("DATABASE_URL")
    USE_MEMORY_STORAGE: bool = os.getenv("USE_MEMORY_STORAGE", "true").lower() == "true"
    
    # Optimization settings
    MAX_TRIALS_PER_STUDY: int = int(os.getenv("MAX_TRIALS_PER_STUDY", "1000"))
    DEFAULT_TIMEOUT_SECONDS: int = int(os.getenv("DEFAULT_TIMEOUT_SECONDS", "3600"))  # 1 hour
    
    # Job settings
    MAX_CONCURRENT_JOBS: int = int(os.getenv("MAX_CONCURRENT_JOBS", "10"))


settings = Settings()