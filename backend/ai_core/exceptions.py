class AIError(Exception):
    code = "ai_error"

class AIProviderUnavailable(AIError):
    code = "provider_unavailable"

class AIProviderTimeout(AIError):
    code = "provider_timeout"

class AIProviderRateLimited(AIError):
    code = "provider_rate_limited"

class AIUnsupportedCapability(AIError):
    code = "unsupported_capability"

class AIInvalidStructuredOutput(AIError):
    code = "invalid_structured_output"

class AIBusinessValidationFailed(AIError):
    code = "business_validation_failed"

class AIQuotaExceeded(AIError):
    code = "quota_exceeded"

class AIBudgetExceeded(AIError):
    code = "budget_exceeded"

class AIConfigurationError(AIError):
    code = "configuration_error"

class AIPermissionDenied(AIError):
    code = "permission_denied"

class AIToolError(AIError):
    code = "tool_error"

class AIToolNotFound(AIError):
    code = "tool_not_found"

class AIToolPermissionDenied(AIError):
    code = "tool_permission_denied"
