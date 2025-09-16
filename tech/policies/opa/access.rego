package access

default allow = false
default step_up_required = false

# Allow read access to Public documents for everyone
allow {
    input.action == "read"
    input.resource.label == "Public"
}

# Allow read access to Internal documents for engineering group
allow {
    input.action == "read"
    input.resource.label == "Internal"
    "eng" in input.subject.groups
}

# Allow read access to Confidential documents for users with confidential clearance
allow {
    input.action == "read"
    input.resource.label == "Confidential"
    input.subject.attrs.clearance == "confidential"
}

# Allow read access to Regulated documents for users with regulated clearance
allow {
    input.action == "read"
    input.resource.label == "Regulated"
    input.subject.attrs.clearance == "regulated"
}

# Require step-up authentication for Confidential and Regulated documents
step_up_required {
    input.resource.label in ["Confidential", "Regulated"]
    not input.subject.attrs.mfa_satisfied
}

# Deny export for Regulated documents unless user has regulated clearance
deny {
    input.action == "export"
    input.resource.label == "Regulated"
    input.subject.attrs.clearance != "regulated"
}