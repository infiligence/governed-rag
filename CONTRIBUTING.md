# Contributing to Governed RAG

Thank you for your interest in contributing to the Governed RAG platform! This document provides guidelines and instructions for contributors.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Adding New Services](#adding-new-services)
- [Policy Development](#policy-development)

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Node.js 18+ (for TypeScript services)
- Python 3.11+ (for Python services)
- Git
- Basic understanding of:
  - Microservices architecture
  - Policy-based access control
  - Vector databases
  - RAG (Retrieval-Augmented Generation)

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/governed-rag.git
   cd governed-rag
   ```
3. Add upstream remote:
   ```bash
   git remote add upstream https://github.com/infiligence/governed-rag.git
   ```

## Development Setup

### Quick Start

```bash
# Start all services
make up

# Seed database
make seed

# View logs
make logs

# Stop services
make down
```

### Local Service Development

#### TypeScript Services (Gateway, PDP, Explain, Lineage, Federation)

```bash
cd demo/services/SERVICE_NAME
npm install
npm run dev
```

#### Python Services (Classifier, Redactor, Guardrails)

```bash
cd demo/services/SERVICE_NAME
pip install -r requirements.txt
python main.py
```

### Database Access

```bash
# Connect to PostgreSQL
docker exec -it $(docker ps -qf "name=postgres") psql -U postgres -d govrag

# Common queries
SELECT * FROM identities;
SELECT * FROM documents;
SELECT * FROM audit_events ORDER BY ts DESC LIMIT 10;
```

## Project Structure

```
governed-rag-demo/
├── tech/                          # Reference implementations
│   ├── policies/                  # OPA and Cedar policies
│   │   ├── opa/access.rego       # Main OPA policy file
│   │   └── cedar/policies.cedar   # Cedar policy examples
│   ├── storage/schema.sql         # PostgreSQL schema with pgvector
│   ├── redaction/pii_patterns.yaml # PII detection patterns
│   ├── guardrails/                # Guardrails DSL examples
│   ├── lineage/lineage.md         # Lineage documentation
│   └── audit/                     # Audit model and queries
│
└── demo/                          # Runnable demo
    ├── docker-compose.yml         # Service orchestration
    ├── services/                  # Microservices
    │   ├── gateway-api/           # Main API gateway (TypeScript)
    │   ├── classifier/            # Document classification (Python)
    │   ├── pdp/                   # Policy Decision Point (TypeScript)
    │   ├── indexer/               # Document processing (TypeScript)
    │   ├── retriever/             # Governed retrieval (TypeScript)
    │   ├── redactor/              # PII/PHI redaction (Python)
    │   ├── guardrails/            # Guardrails DSL (Python)
    │   ├── explain/               # Explainability (TypeScript)
    │   ├── lineage/               # Audit ledger (TypeScript)
    │   └── federation/            # Multi-source (TypeScript)
    ├── seed/                      # Initial data
    └── scripts/                   # Utility scripts
```

## Coding Standards

### TypeScript

- Use TypeScript strict mode
- Follow the existing code style
- Use meaningful variable names
- Add JSDoc comments for public APIs
- Use async/await for asynchronous operations

Example:
```typescript
/**
 * Retrieves user information from database
 * @param userId - The unique user identifier
 * @returns User object or null if not found
 */
async function getUser(userId: string): Promise<User | null> {
  const query = `SELECT * FROM identities WHERE user_id = $1`;
  const result = await db.query(query, [userId]);
  return result.rows[0] || null;
}
```

### Python

- Follow PEP 8 style guide
- Use type hints
- Add docstrings for functions and classes
- Use async/await with FastAPI

Example:
```python
async def classify_document(
    text: str,
    metadata: Dict[str, Any]
) -> ClassificationResult:
    """
    Classify a document based on content and metadata.
    
    Args:
        text: Document content to classify
        metadata: Additional document metadata
        
    Returns:
        Classification result with label and confidence
    """
    # Implementation
    pass
```

### Rego (OPA Policies)

- One rule per logical condition
- Add comments explaining policy intent
- Use descriptive rule names
- Test policies with sample inputs

Example:
```rego
# Allow read access to Internal documents for engineering group
allow {
    input.action == "read"
    input.resource.label == "Internal"
    "eng" in input.subject.groups
}
```

## Testing

### Unit Tests

```bash
# TypeScript services
cd demo/services/SERVICE_NAME
npm test

# Python services
cd demo/services/SERVICE_NAME
pytest
```

### Integration Tests

```bash
# Start all services
make up

# Run integration tests
make test

# Test specific scenarios
./demo/scripts/test_scenarios.sh
```

### Policy Testing

```bash
# Test OPA policies
curl -X POST http://localhost:3001/test

# Test specific policy decision
curl -X POST http://localhost:3001/authorize \
  -H 'Content-Type: application/json' \
  -d '{
    "subject": {...},
    "resource": {...},
    "action": "read"
  }'
```

## Pull Request Process

### Before Submitting

1. **Create a feature branch**:
   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Make your changes**:
   - Write clean, documented code
   - Add tests for new functionality
   - Update documentation as needed

3. **Test thoroughly**:
   ```bash
   make test
   npm test  # For TypeScript services
   pytest    # For Python services
   ```

4. **Commit with conventional commits**:
   ```bash
   git commit -m "feat(gateway): add new endpoint for X"
   git commit -m "fix(classifier): resolve classification bug"
   git commit -m "docs(readme): update installation instructions"
   ```

   Types:
   - `feat`: New feature
   - `fix`: Bug fix
   - `docs`: Documentation changes
   - `chore`: Maintenance tasks
   - `test`: Test additions/changes
   - `refactor`: Code refactoring

5. **Push to your fork**:
   ```bash
   git push origin feat/your-feature-name
   ```

### Pull Request Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex logic
- [ ] Documentation updated
- [ ] No new warnings generated
- [ ] Tests added/updated
```

## Adding New Services

### Service Template

1. **Create service directory**:
   ```bash
   mkdir -p demo/services/your-service/src
   ```

2. **Add package.json (TypeScript)** or **requirements.txt (Python)**

3. **Implement service**:
   - Health check endpoint: `GET /health`
   - Main functionality endpoints
   - Error handling
   - Logging

4. **Add Dockerfile**:
   ```dockerfile
   FROM node:18-alpine  # or python:3.11-slim
   WORKDIR /app
   COPY package*.json ./
   RUN npm install
   COPY . .
   RUN npm run build
   EXPOSE 3XXX
   CMD ["npm", "start"]
   ```

5. **Update docker-compose.yml**:
   ```yaml
   your-service:
     build:
       context: ./services/your-service
     ports:
       - "3XXX:3XXX"
     environment:
       - POSTGRES_URL=...
     depends_on:
       - postgres
     healthcheck:
       test: ["CMD", "curl", "-f", "http://localhost:3XXX/health"]
   ```

6. **Add documentation** in service README

## Policy Development

### Adding New OPA Policies

1. **Edit policy file**:
   ```bash
   vim tech/policies/opa/access.rego
   ```

2. **Add new rule**:
   ```rego
   # Description of what this rule allows
   allow {
       input.action == "action_name"
       # Additional conditions
   }
   ```

3. **Test policy**:
   ```bash
   # Reload OPA
   docker restart $(docker ps -qf "name=opa")
   
   # Test decision
   curl -X POST http://localhost:3001/authorize \
     -d '{"subject": {...}, "resource": {...}, "action": "action_name"}'
   ```

4. **Document policy** in `tech/policies/README.md`

### Adding Redaction Patterns

1. **Edit patterns file**:
   ```bash
   vim tech/redaction/pii_patterns.yaml
   ```

2. **Add new pattern**:
   ```yaml
   - id: new_pattern
     type: pii
     regex: "pattern_regex_here"
     replacement: "[REDACTED]"
     sensitivity: high
   ```

3. **Test pattern**:
   ```bash
   curl -X POST http://localhost:3007/detect \
     -d '{"text": "test text with pattern"}'
   ```

## Code Review Guidelines

### For Reviewers

- Check code quality and style
- Verify tests are present and passing
- Review security implications
- Ensure documentation is updated
- Test functionality locally if possible

### For Contributors

- Respond to feedback promptly
- Make requested changes in new commits
- Update PR description if scope changes
- Be open to suggestions

## Community Guidelines

### Code of Conduct

- Be respectful and inclusive
- Welcome newcomers
- Provide constructive feedback
- Focus on the code, not the person
- Assume good intentions

### Getting Help

- GitHub Discussions for questions
- GitHub Issues for bug reports
- Documentation in `tech/` directory
- Demo scripts in `demo/scripts/`

## Release Process

1. All PRs merged to `main`
2. Version bumped following semver
3. Changelog updated
4. Git tag created
5. Release notes published

## License

By contributing, you agree that your contributions will be licensed under the same MIT License that covers the project.

