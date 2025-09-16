# Identity Provider Configuration

## SCIM Mock Configuration

This demo uses a simplified SCIM (System for Cross-domain Identity Management) mock for user and group management.

### User Attributes

- `user_id`: Unique identifier (email format)
- `email`: User email address
- `groups`: Array of group memberships
- `mfa_level`: Multi-factor authentication level (1-3)
- `attributes`: JSON object with clearance level and other attributes

### Group Structure

- `eng`: Engineering team - can access Internal documents
- `legal`: Legal team - can access Regulated documents with proper clearance
- `external`: External vendors - limited to Public documents

### Clearance Levels

- `public`: Can access Public documents
- `internal`: Can access Public and Internal documents  
- `confidential`: Can access Public, Internal, and Confidential documents
- `regulated`: Can access all document types

### MFA Requirements

- Level 1: Basic authentication
- Level 2: Required for Confidential documents
- Level 3: Required for Regulated documents

### Session Management

Sessions are managed via JWT tokens containing:
- `tenant`: Organization identifier
- `groups`: User group memberships
- `attrs`: User attributes including clearance
- `exp`: Token expiration
- `mfa_satisfied`: MFA completion status
