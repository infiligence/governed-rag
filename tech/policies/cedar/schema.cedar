entity User {
  groups: Set<String>,
  attrs: Record<String, String>,
  mfa_satisfied: Boolean
};

entity Doc {
  label: String,
  source: String,
  owner: String,
  tenant: String
};

action Read, Export appliesTo (User, Doc);
