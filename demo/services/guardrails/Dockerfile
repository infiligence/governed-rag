FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py ./

# Create directory for config
RUN mkdir -p /app/tech/guardrails

EXPOSE 3006

CMD ["python", "main.py"]

