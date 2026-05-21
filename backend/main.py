try:
    from backend.app.main import app
except ModuleNotFoundError:
    from app.main import app
