FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py ./

# Create directory for patterns
RUN mkdir -p /app/tech/redaction

EXPOSE 3007

CMD ["python", "main.py"]

