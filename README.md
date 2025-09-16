# Governed Permission-Aware RAG Demo

A comprehensive demonstration framework showcasing policy-driven classification, permission-aware retrieval, zero-trust controls, auditability, DLP/redaction, governed RAG, and lifecycle/legal controls.

## 🚀 Quick Start (90 seconds)

```bash
# 1. Start all services
make up

# 2. Load initial data
make seed

# 3. Run demo scenarios
make demo
```

## 🏗️ Architecture Overview

This demo implements a governed RAG system with the following components:

### Core Services
- **Gateway API** (Node.js/TypeScript) - Main API orchestrating all operations
- **Classifier** (Python/FastAPI) - Document classification using hybrid rules + ML
- **PDP** (Policy Decision Point) - OPA wrapper for access control decisions
- **Indexer** (Node.js/TypeScript) - Document processing and embedding generation
- **Retriever** (Node.js/TypeScript) - Governed retrieval with policy enforcement

### Infrastructure
- **PostgreSQL + pgvector** - Vector database for embeddings and metadata
- **Redis** - Caching and session management
- **OPA** (Open Policy Agent) - Policy evaluation engine
- **Docker Compose** - Service orchestration

### Key Features
- 🔒 **Zero-trust Access Controls** - Policy-driven authorization
- 🏷️ **Document Classification** - Automatic labeling (Public/Internal/Confidential/Regulated)
- 🔍 **Permission-aware Retrieval** - Filter-at-index and filter-at-query
- 🛡️ **PII/PHI Redaction** - Automatic masking based on classification
- 📊 **Complete Auditability** - Hash-chained audit trail
- 🚫 **Cross-tenant Isolation** - Strict boundary enforcement
- ⚡ **Step-up Authentication** - MFA for sensitive content
- 📋 **Export Controls** - Policy-based export restrictions

## 📁 Project Structure

```
governed-rag-demo/
├── tech/                          # Reference implementations & configs
│   ├── policies/                  # OPA and Cedar policies
│   ├── identity/                  # SCIM mock and IDP config
│   ├── storage/                   # Database schema and docs
│   ├── redaction/                 # PII/PHI patterns and rules
│   ├── rag/                       # Chunking and guardrails docs
│   └── audit/                     # Audit model and queries
└── demo/                          # Runnable sandbox
    ├── docker-compose.yml         # Service orchestration
    ├── services/                  # All microservices
    │   ├── gateway-api/           # Main API gateway
    │   ├── classifier/            # Python classification service
    │   ├── pdp/                   # OPA wrapper service
    │   ├── indexer/               # Document processing worker
    │   ├── retriever/             # Governed retrieval module
    │   └── redactor/              # PII/PHI redaction library
    ├── seed/                      # Initial data and documents
    └── scripts/                   # Setup and demo scripts
```

## 🎯 Demo Scenarios

### Scenario A: Same Query, Different Users
Demonstrate how users with different clearance levels see different results for the same query.

```bash
# Alice (internal clearance) vs Sam (regulated clearance)
curl -X POST http://localhost:8080/search \
  -H "Authorization: Bearer <token>" \
  -d '{"query": "security policies", "user_id": "alice@dash"}'
```

### Scenario B: Step-up Authentication
Show MFA requirement for sensitive content.

```bash
# Requires step-up for confidential content
curl -X POST http://localhost:8080/auth/step-up \
  -H "Authorization: Bearer <token>" \
  -d '{"user_id": "bob@dash", "mfa_token": "demo"}'
```

### Scenario C: Redaction vs Deny
Demonstrate different redaction behaviors based on classification.

### Scenario D: Export Blocked
Show export restrictions based on user permissions.

### Scenario E: Audit Replay
Display comprehensive audit trail with hash chain integrity.

## 🔧 Development

### Prerequisites
- Docker and Docker Compose
- Node.js 18+ (for local development)
- Python 3.11+ (for classifier development)

### Local Development
```bash
# Setup development environment
make dev-setup

# Start services in development mode
make up

# View logs
make logs

# Run tests
make test
```

### Service Development
Each service is independently deployable:

```bash
# Gateway API
cd demo/services/gateway-api
npm install
npm run dev

# Classifier
cd demo/services/classifier
pip install -r requirements.txt
python main.py

# PDP
cd demo/services/pdp
npm install
npm run dev
```

## 🔒 Security Features

### Access Control
- **RBAC** (Role-Based Access Control) - Group-based permissions
- **ABAC** (Attribute-Based Access Control) - Clearance-based access
- **Policy Evaluation** - Real-time OPA policy decisions
- **Tenant Isolation** - Strict cross-tenant boundaries

### Data Protection
- **Automatic Classification** - ML + rules-based labeling
- **PII/PHI Redaction** - Pattern-based masking
- **Encryption** - Data at rest and in transit
- **Audit Trail** - Immutable hash-chained logs

### Compliance
- **GDPR** - Right to be forgotten, data portability
- **HIPAA** - PHI protection and audit requirements
- **SOX** - Financial data access controls
- **PCI DSS** - Payment card data protection

## 📊 Monitoring & Observability

### Health Checks
```bash
# Check all services
make test

# Individual service health
curl http://localhost:8080/health
curl http://localhost:3001/health
curl http://localhost:8000/health
```

### Audit Queries
```sql
-- Who accessed what in the last 24 hours
SELECT actor_user_id, action, object_id, policy_decision, ts
FROM audit_events 
WHERE ts > NOW() - INTERVAL '24 hours'
ORDER BY ts DESC;

-- Policy effectiveness analysis
SELECT policy_decision, reason, COUNT(*) as count
FROM audit_events 
WHERE ts > NOW() - INTERVAL '7 days'
GROUP BY policy_decision, reason;
```

## 🚀 Production Deployment

### Environment Configuration
```bash
# Production environment variables
export POSTGRES_URL="postgres://user:pass@prod-db:5432/govrag"
export REDIS_URL="redis://prod-redis:6379"
export JWT_SECRET="production-secret-key"
export TENANT="production"
```

### Scaling Considerations
- **Horizontal Scaling** - Stateless services can be scaled horizontally
- **Database Optimization** - Connection pooling, read replicas
- **Caching Strategy** - Redis for session and query caching
- **Load Balancing** - Multiple gateway instances

### Security Hardening
- **Network Security** - VPC, security groups, private subnets
- **Secrets Management** - AWS Secrets Manager, HashiCorp Vault
- **Certificate Management** - Automated SSL/TLS certificate rotation
- **Monitoring** - CloudWatch, Prometheus, Grafana

## 🧪 Testing

### Unit Tests
```bash
# Run unit tests for each service
cd demo/services/gateway-api && npm test
cd demo/services/pdp && npm test
cd demo/services/redactor && npm test
```

### Integration Tests
```bash
# Test end-to-end scenarios
make test

# Test specific scenarios
curl -X POST http://localhost:8080/search \
  -H "Authorization: Bearer <token>" \
  -d '{"query": "test query", "user_id": "test@example.com"}'
```

### Load Testing
```bash
# Concurrent request testing
for i in {1..10}; do
  curl -X POST http://localhost:8080/search \
    -H "Authorization: Bearer <token>" \
    -d '{"query": "load test", "user_id": "test@example.com"}' &
done
```

## 📚 Documentation

- **Technical Documentation** - `tech/` directory
- **API Documentation** - OpenAPI/Swagger specs
- **Policy Documentation** - OPA and Cedar policies
- **Demo Scenarios** - `demo/scripts/demo_scenarios.md`

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

- **Issues** - GitHub Issues for bug reports
- **Discussions** - GitHub Discussions for questions
- **Documentation** - Check the `tech/` directory for detailed docs

## 🎉 Acknowledgments

This demo framework showcases best practices for governed RAG systems, including:
- Policy-driven access control
- Zero-trust security principles
- Comprehensive auditability
- Data protection and privacy
- Regulatory compliance
- Scalable architecture patterns
