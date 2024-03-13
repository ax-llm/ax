ParsedSignature
  = inputs:ParsedFieldList __ "->" __ outputs:ParsedFieldList {
      return { inputs, outputs };
    }

ParsedFieldList
  = head:ParsedField tail:(","  ParsedField)* {
      return [head, ...tail.map(([, output]) => output)];
    }

ParsedField
  = _ name:ParsedIdentifier optionalType:(_ ":" _ ParsedType)? optionalDesc:(_ ParsedString _)? {
      return { 
        name, 
        desc: optionalDesc ? optionalDesc.join("") : undefined,
        type: optionalType ? optionalType.at(-1) : undefined
      };
    }
    
ParsedType
    = chars:[a-zA-Z_0-9]* isArray:("[]")? {
    	return { name: chars.join(""), isArray: isArray ? true : false }
    }

ParsedIdentifier
    = chars:[a-zA-Z_0-9]* {
    	return chars.join("")
    }

ParsedString
  = "'" content:[^']* "'" { return content.join(""); }
  / '"' content:[^"]* '"' { return content.join(""); }


// optional whitespace
_  = [ \t\r\n]*  {
    	return ""
    }

// mandatory whitespace
__ = [ \t\r\n]+ {
    	return ""
    }