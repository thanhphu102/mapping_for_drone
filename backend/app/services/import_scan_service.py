from fastapi import HTTPException


class ImportScanService:
    def not_implemented(self) -> None:
        raise HTTPException(
            status_code=501,
            detail="Scan JSON import is not implemented yet",
        )

