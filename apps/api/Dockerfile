FROM python:3.11-slim
WORKDIR /srv
COPY apps/api/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY services ./services
COPY apps/api/app ./app
ENV USE_SIMULATOR=true
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
