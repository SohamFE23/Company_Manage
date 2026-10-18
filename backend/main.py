
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers.work_items import router as work_items_router
from app.routers.teams import router as teams_router
from app.auth import router as auth_router

app = FastAPI(
    title="OpsFlow API",
    description="Operations management backend",
    version="1.0.0",
)

app.include_router(work_items_router)
app.include_router(teams_router)
app.include_router(auth_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"message": "OpsFlow API is running"}


@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "application": "OpsFlow",
    }
