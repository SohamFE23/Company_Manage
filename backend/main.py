
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="OpsFlow API",
    description="Operations management backend",
    version="1.0.0",
)

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
