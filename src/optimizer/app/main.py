import logging
import uvicorn

from .api import app
from .config import settings

# Configure logging with more structured format
logging.basicConfig(
    level=logging.INFO if not settings.DEBUG else logging.DEBUG,
    format="[%(asctime)s] [%(levelname)8s] [%(name)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)

logger = logging.getLogger(__name__)


def main():
    """Run the FastAPI server."""
    logger.info("Starting Ax Optimizer Service")
    logger.info(f"Host: {settings.HOST}")
    logger.info(f"Port: {settings.PORT}")
    logger.info(f"Debug mode: {settings.DEBUG}")
    
    if settings.is_redis_available:
        logger.info(f"Redis URL: {settings.REDIS_URL}")
    else:
        logger.info("Storage: In-memory mode (Redis not available)")
    
    logger.info(f"Memory storage: {settings.USE_MEMORY_STORAGE}")
    logger.info(f"Memory queue: {settings.USE_MEMORY_QUEUE}")
    
    uvicorn.run(
        "app.api:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level="info" if not settings.DEBUG else "debug"
    )


if __name__ == "__main__":
    main()