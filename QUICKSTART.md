## 🚀 Quick Start Guide

### Prerequisites
- Docker and Docker Compose
- Git

### Setup Instructions

1. **Clone the repository:**
   ```bash
   git clone https://github.com/rams211/infiligence-governed-rag.git
   cd infiligence-governed-rag
   ```

2. **Start all services:**
   ```bash
   make up
   ```

3. **Load initial data:**
   ```bash
   make seed
   ```

4. **Run demo scenarios:**
   ```bash
   make demo
   ```

### Demo Scenarios
- **Scenario A**: Same query, different users (alice vs sam) - shows clearance-based results
- **Scenario B**: Step-up authentication for sensitive content  
- **Scenario C**: Redaction vs deny based on classification levels
- **Scenario D**: Export blocked based on user permissions
- **Scenario E**: Audit replay with hash-chained integrity

### Architecture
- **PostgreSQL + pgvector**: Vector storage and similarity search
- **OPA (Open Policy Agent)**: Policy evaluation engine
- **Python FastAPI**: Document classification service
- **Node.js/TypeScript**: Gateway API, PDP wrapper, Indexer
- **Redis**: Caching and queues
- **Docker Compose**: Service orchestration

### Key Features
✅ Policy-driven document classification  
✅ Permission-aware retrieval with RBAC/ABAC  
✅ Zero-trust access controls  
✅ Immutable audit trail with hash chaining  
✅ PII/PHI redaction and masking  
✅ Cross-tenant isolation  
✅ Retention policies and legal holds  
✅ Export controls and restrictions  

### API Endpoints
- **Gateway API**: http://localhost:8080
- **Classifier**: http://localhost:8000  
- **PDP**: http://localhost:3001
- **OPA**: http://localhost:8181
- **PostgreSQL**: localhost:5432
- **Redis**: localhost:6379

### Demo Users
- **alice@dash**: Engineering group, internal clearance
- **bob@dash**: Engineering group, public clearance  
- **sam@legal**: Legal group, regulated clearance
- **rita@vendor**: External group, public clearance

### Compliance Features
- GDPR, HIPAA, SOX, PCI DSS considerations
- Immutable audit logs with cryptographic integrity
- Data retention and legal hold policies
- Cross-tenant data isolation
- Policy-driven access controls

---

**Ready for production deployment with proper security configurations!**
