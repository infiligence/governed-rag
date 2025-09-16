# Contributing to Governed RAG

Thank you for your interest in contributing to the Governed RAG framework! 🎉

## 🚀 Quick Start for Contributors

### Prerequisites
- Docker and Docker Compose
- Node.js 18+
- Python 3.11+
- Git

### Development Setup
```bash
# 1. Fork and clone the repository
git clone https://github.com/YOUR_USERNAME/governed-rag.git
cd governed-rag

# 2. Start the development environment
make up

# 3. Load test data
make seed

# 4. Run tests
make test
```

## 🎯 How to Contribute

### 1. Reporting Issues
- Use our [bug report template](.github/ISSUE_TEMPLATE/bug_report.md)
- Check existing issues before creating new ones
- Provide detailed reproduction steps

### 2. Suggesting Features
- Use our [feature request template](.github/ISSUE_TEMPLATE/feature_request.md)
- Explain the problem and proposed solution
- Consider the impact on existing functionality

### 3. Code Contributions

#### Pull Request Process
1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to your branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

#### Code Standards
- **TypeScript**: Use strict mode, proper typing
- **Python**: Follow PEP 8, use type hints
- **Documentation**: Update README and inline docs
- **Tests**: Add tests for new functionality
- **Commits**: Use conventional commit messages

#### Code Style
```bash
# TypeScript/Node.js
npm run lint
npm run format

# Python
black .
flake8 .
mypy .
```

### 4. Documentation Contributions
- Update README.md for major changes
- Add examples for new features
- Improve inline code documentation
- Create tutorials or guides

## 🏗️ Project Structure

```
governed-rag/
├── tech/                    # Reference implementations
│   ├── policies/            # OPA and Cedar policies
│   ├── identity/            # SCIM mock and IDP config
│   ├── storage/             # Database schema
│   ├── redaction/           # PII/PHI patterns
│   ├── rag/                 # Chunking and guardrails
│   └── audit/               # Audit model
└── demo/                    # Runnable services
    ├── services/            # Microservices
    ├── seed/                # Test data
    └── scripts/             # Setup scripts
```

## 🧪 Testing

### Running Tests
```bash
# All tests
make test

# Individual services
cd demo/services/gateway-api && npm test
cd demo/services/pdp && npm test
cd demo/services/classifier && python -m pytest
```

### Test Coverage
- Aim for >80% code coverage
- Test both happy path and edge cases
- Include integration tests for API endpoints

## 🔒 Security

### Security Guidelines
- Never commit secrets or API keys
- Use environment variables for configuration
- Follow security best practices for authentication
- Report security vulnerabilities privately

### Reporting Security Issues
- Email: security@infiligence.com
- Use GitHub's private vulnerability reporting
- Do not create public issues for security problems

## 📋 Development Workflow

### Branch Naming
- `feature/description` - New features
- `bugfix/description` - Bug fixes
- `docs/description` - Documentation updates
- `refactor/description` - Code refactoring

### Commit Messages
Use conventional commits:
```
feat: add new authentication method
fix: resolve memory leak in retriever
docs: update API documentation
test: add integration tests for PDP
```

### Pull Request Guidelines
- **Title**: Clear, descriptive title
- **Description**: Explain what and why
- **Tests**: Include test results
- **Screenshots**: For UI changes
- **Breaking Changes**: Clearly mark them

## 🎨 Design Principles

### Architecture
- **Microservices**: Loosely coupled, independently deployable
- **Policy-Driven**: Access control via OPA policies
- **Zero-Trust**: Verify everything, trust nothing
- **Auditable**: Complete audit trail for compliance

### Code Quality
- **Readable**: Self-documenting code
- **Testable**: Easy to unit test
- **Maintainable**: Clear separation of concerns
- **Secure**: Security by design

## 🚀 Release Process

### Versioning
We use [Semantic Versioning](https://semver.org/):
- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

### Release Checklist
- [ ] All tests passing
- [ ] Documentation updated
- [ ] Security scan clean
- [ ] Performance benchmarks met
- [ ] Breaking changes documented

## 💬 Community

### Getting Help
- **GitHub Discussions**: For questions and ideas
- **Issues**: For bugs and feature requests
- **Discord**: Real-time chat (coming soon)

### Code of Conduct
- Be respectful and inclusive
- Welcome newcomers
- Focus on constructive feedback
- Help others learn and grow

## 🏆 Recognition

### Contributors
- All contributors are listed in CONTRIBUTORS.md
- Significant contributors get maintainer status
- Regular contributors receive swag and recognition

### Contribution Types
- **Code**: Bug fixes, features, refactoring
- **Documentation**: README, guides, tutorials
- **Testing**: Unit tests, integration tests
- **Community**: Helping others, answering questions

## 📞 Contact

- **Maintainer**: @rams211
- **Email**: maintainers@infiligence.com
- **Discord**: [Join our community](https://discord.gg/infiligence)

---

Thank you for contributing to Governed RAG! Together, we're building the future of secure, policy-driven AI systems. 🌟
