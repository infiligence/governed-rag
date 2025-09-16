/**
 * Policy Decision Point (PDP) Wrapper Service
 * 
 * This service wraps OPA (Open Policy Agent) to provide policy decisions
 * for the governed RAG system.
 */

import express from 'express';
import axios from 'axios';
import { z } from 'zod';

const app = express();
app.use(express.json());

// OPA server configuration
const OPA_URL = process.env.OPA_URL || 'http://opa:8181';
const POLICY_PACKAGE = 'access';

// Input validation schemas
const SubjectSchema = z.object({
  user_id: z.string(),
  groups: z.array(z.string()),
  attrs: z.record(z.string())
});

const ResourceSchema = z.object({
  label: z.string(),
  source: z.string(),
  owner: z.string(),
  tenant: z.string()
});

const AuthorizationRequestSchema = z.object({
  subject: SubjectSchema,
  resource: ResourceSchema,
  action: z.string()
});

const ExplainRequestSchema = z.object({
  subject: SubjectSchema,
  resource: ResourceSchema,
  action: z.string(),
  decision: z.string().optional()
});

interface AuthorizationRequest {
  subject: {
    user_id: string;
    groups: string[];
    attrs: Record<string, any>;
  };
  resource: {
    label: string;
    source: string;
    owner: string;
    tenant: string;
  };
  action: string;
}

interface AuthorizationResponse {
  allow: boolean;
  step_up_required: boolean;
  reason?: string;
  policy_id?: string;
}

interface ExplainResponse {
  decision: string;
  rules_applied: string[];
  reasoning: string;
  policy_id?: string;
}

/**
 * Query OPA for policy decision
 */
async function queryOPA(input: AuthorizationRequest): Promise<any> {
  try {
    const response = await axios.post(`${OPA_URL}/v1/data/${POLICY_PACKAGE}`, {
      input
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });
    
    return response.data.result;
  } catch (error) {
    console.error('OPA query failed:', error);
    throw new Error('Policy evaluation failed');
  }
}

/**
 * Authorize access based on policy
 */
app.post('/authorize', async (req, res) => {
  try {
    // Validate input
    const validatedInput = AuthorizationRequestSchema.parse(req.body);
    
    // Query OPA
    const opaResult = await queryOPA(validatedInput);
    
    // Extract decision
    const allow = opaResult.allow || false;
    const stepUpRequired = opaResult.step_up_required || false;
    
    const response: AuthorizationResponse = {
      allow,
      step_up_required: stepUpRequired,
      reason: allow ? 'Access granted' : 'Access denied by policy',
      policy_id: opaResult.policy_id
    };
    
    console.log(`Authorization decision: ${allow ? 'ALLOW' : 'DENY'} for user ${validatedInput.subject.user_id}`);
    
    res.json(response);
  } catch (error) {
    console.error('Authorization error:', error);
    res.status(500).json({
      error: 'Authorization failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Explain policy decision
 */
app.post('/explain', async (req, res) => {
  try {
    // Validate input
    const validatedInput = ExplainRequestSchema.parse(req.body);
    
    // Query OPA for explanation
    const opaResult = await queryOPA(validatedInput);
    
    // Generate explanation
    const decision = opaResult.allow ? 'ALLOW' : 'DENY';
    const rulesApplied: string[] = [];
    let reasoning = '';
    
    if (opaResult.allow) {
      if (validatedInput.resource.label === 'Public') {
        rulesApplied.push('public_access');
        reasoning = 'Public documents are accessible to all users';
      } else if (validatedInput.resource.label === 'Internal' && 
                 validatedInput.subject.groups.includes('eng')) {
        rulesApplied.push('rbac_internal');
        reasoning = 'Internal documents accessible to engineering group';
      } else if (validatedInput.subject.attrs.clearance === 'confidential' &&
                 validatedInput.resource.label === 'Confidential') {
        rulesApplied.push('abac_confidential');
        reasoning = 'User has confidential clearance';
      } else if (validatedInput.subject.attrs.clearance === 'regulated' &&
                 validatedInput.resource.label === 'Regulated') {
        rulesApplied.push('abac_regulated');
        reasoning = 'User has regulated clearance';
      }
    } else {
      if (opaResult.step_up_required) {
        rulesApplied.push('step_up_required');
        reasoning = 'Multi-factor authentication required for sensitive content';
      } else {
        rulesApplied.push('access_denied');
        reasoning = 'User lacks required permissions for this resource';
      }
    }
    
    const response: ExplainResponse = {
      decision,
      rules_applied: rulesApplied,
      reasoning,
      policy_id: opaResult.policy_id
    };
    
    res.json(response);
  } catch (error) {
    console.error('Explanation error:', error);
    res.status(500).json({
      error: 'Explanation failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/health', async (req, res) => {
  try {
    // Test OPA connectivity
    await axios.get(`${OPA_URL}/health`, { timeout: 2000 });
    
    res.json({
      status: 'healthy',
      service: 'pdp',
      opa_connected: true
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      service: 'pdp',
      opa_connected: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get policy information
 */
app.get('/policies', async (req, res) => {
  try {
    const response = await axios.get(`${OPA_URL}/v1/policies`, { timeout: 2000 });
    
    res.json({
      policies: response.data.result || [],
      package: POLICY_PACKAGE
    });
  } catch (error) {
    console.error('Policy info error:', error);
    res.status(500).json({
      error: 'Failed to retrieve policy information',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Test policy with sample data
 */
app.post('/test', async (req, res) => {
  try {
    const testCases = [
      {
        name: 'Public document access',
        input: {
          subject: { user_id: 'test@example.com', groups: ['eng'], attrs: { clearance: 'internal' } },
          resource: { label: 'Public', source: 'dropbox', owner: 'test@example.com', tenant: 'dash' },
          action: 'read'
        }
      },
      {
        name: 'Internal document with engineering group',
        input: {
          subject: { user_id: 'alice@dash', groups: ['eng'], attrs: { clearance: 'internal' } },
          resource: { label: 'Internal', source: 'dropbox', owner: 'alice@dash', tenant: 'dash' },
          action: 'read'
        }
      },
      {
        name: 'Confidential document requiring step-up',
        input: {
          subject: { user_id: 'bob@dash', groups: ['eng'], attrs: { clearance: 'confidential', mfa_satisfied: false } },
          resource: { label: 'Confidential', source: 'dropbox', owner: 'bob@dash', tenant: 'dash' },
          action: 'read'
        }
      }
    ];
    
    const results = [];
    for (const testCase of testCases) {
      try {
        const opaResult = await queryOPA(testCase.input);
        results.push({
          name: testCase.name,
          input: testCase.input,
          result: opaResult
        });
      } catch (error) {
        results.push({
          name: testCase.name,
          input: testCase.input,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    res.json({ test_results: results });
  } catch (error) {
    console.error('Test error:', error);
    res.status(500).json({
      error: 'Test failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`PDP service running on port ${PORT}`);
  console.log(`OPA URL: ${OPA_URL}`);
  console.log(`Policy package: ${POLICY_PACKAGE}`);
});

export default app;
