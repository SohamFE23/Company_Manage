import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.auth import router as auth_router
from app.config import settings
from app.database import engine
from app.routers.admin import router as admin_router
from app.routers.teams import router as teams_router
from app.routers.work_items import router as work_items_router

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("opswork")


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("OpsWork API starting (env=%s)", settings.environment)
    yield
    engine.dispose()
    logger.info("OpsWork API stopped")


# Interactive docs are useful locally but should not be public in production.
docs_enabled = not settings.is_production

app = FastAPI(
    title="OpsWork API",
    description="Operations management backend",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if docs_enabled else None,
    redoc_url="/redoc" if docs_enabled else None,
    openapi_url="/openapi.json" if docs_enabled else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(teams_router)
app.include_router(work_items_router)


@app.get("/")
def root():
    return {"message": "OpsWork API is running"}


@app.get("/api/health")
def health_check():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception:
        logger.exception("Health check failed")
        return JSONResponse(
            status_code=503,
            content={"status": "unhealthy", "application": "OpsWork"},
        )

    return {"status": "healthy", "application": "OpsWork"}