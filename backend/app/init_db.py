from app.config import settings

if settings.is_production:
    raise SystemExit("Database initialization is disabled in production.")

from app import models  # noqa: F401  (registers tables on Base.metadata)
from app.database import Base, engine


def main() -> None:
    Base.metadata.create_all(bind=engine)
    print("OpsFlow database tables created successfully.")


if __name__ == "__main__":
    main()