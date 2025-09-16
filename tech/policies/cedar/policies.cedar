permit (u: User, d: Doc) when { d.label == "Public" } on Read;

permit (u: User, d: Doc) when { 
  d.label == "Internal" && 
  u.groups.contains("eng") 
} on Read;

permit (u: User, d: Doc) when { 
  d.label == "Confidential" && 
  u.attrs.clearance == "confidential" &&
  u.mfa_satisfied
} on Read;

permit (u: User, d: Doc) when { 
  d.label == "Regulated" && 
  u.attrs.clearance == "regulated" &&
  u.mfa_satisfied
} on Read;

forbid (u: User, d: Doc) when { 
  d.label in ["Confidential","Regulated"] && 
  !u.mfa_satisfied 
} on Read;

forbid (u: User, d: Doc) when { 
  d.label == "Regulated" && 
  !u.attrs.contains("regulated") 
} on Read, Export;

permit (u: User, d: Doc) when { d.label == "Public" } on Export;

permit (u: User, d: Doc) when { 
  d.label == "Internal" && 
  u.groups.contains("eng") 
} on Export;
