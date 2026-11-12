# 빌드 컨텍스트는 ml/ 다: docker build -f serve/Dockerfile -t hopornot-serve .
FROM python:3.12-slim

# LightGBM이 OpenMP를 쓴다
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY serve/requirements.txt serve/requirements.txt
RUN pip install --no-cache-dir -r serve/requirements.txt

COPY src/ src/
COPY serve/ serve/
# 학습 산출물: 맥에서 학습한 뒤 서버로 복사한다 (serve/README.md)
COPY models/lgbm.txt models/waiting.json models/waiting_cells.parquet models/
COPY data/interim/stops.parquet data/interim/boarding_profile.parquet data/interim/

EXPOSE 8000
CMD ["uvicorn", "serve.app:app", "--host", "0.0.0.0", "--port", "8000"]
