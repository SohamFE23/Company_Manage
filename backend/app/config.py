import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


def _split(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    environment: str
    database_url: str
    jwt_secret_key: str
    token_expire_hours: int
    cors_origins: list[str]
    log_level: str

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


def _load() -> Settings:
    environment = os.getenv("APP_ENV", "development").strip().lower()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is missing from backend/.env")

    secret = os.getenv("JWT_SECRET_KEY")
    if not secret:
        raise RuntimeError("JWT_SECRET_KEY is missing from backend/.env")
    if environment == "production" and len(secret) < 32:
        raise RuntimeError(
            "JWT_SECRET_KEY must be at least 32 characters in production."
        )

    origins = _split(os.getenv("CORS_ORIGINS", "http://localhost:5173"))
    if environment == "production" and (not origins or "*" in origins):
        raise RuntimeError(
            "CORS_ORIGINS must list explicit origins in production."
        )

    return Settings(
        environment=environment,
        database_url=database_url,
        jwt_secret_key=secret,
        token_expire_hours=int(os.getenv("TOKEN_EXPIRE_HOURS", "8")),
        cors_origins=origins,
        log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
    )


settings = _load()