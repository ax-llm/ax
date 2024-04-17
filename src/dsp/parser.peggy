ParsedSignature 
= optionalDesc:(_ ParsedString _)? inputs:ParsedFieldList __ "->" __ outputs:ParsedFieldList _ {
    return { 
        desc: optionalDesc ? optionalDesc.join("").trim() : undefined,
        inputs, 
        outputs
    };
}

ParsedFieldList = ParsedField |.., _ "," _| 

ParsedField 
= _ name:ParsedIdentifier isOptional:("?")? optionalType:(_ ":" _ ParsedType)? optionalDesc:(_ ParsedString)? {
      return { 
        name, 
        desc: optionalDesc ? optionalDesc.join("").trim() : undefined,
        type: optionalType ? optionalType.at(-1) : undefined,
        isOptional: isOptional ? true : undefined
    };
}
    
ParsedType = chars:[a-zA-Z_0-9]* isArray:("[]")? {
    	return { name: chars.join(""), isArray: isArray ? true : false }
}

ParsedIdentifier = chars:[a-zA-Z_0-9]* {
    	return chars.join("")
}

ParsedString = 
    "'" content:[^']* "'" { return content.join("") } 
    / '"' content:[^"]* '"' { return content .join("") }


// optional whitespace
_  = [ \t\r\n]*  {
    	return ""
}

// mandatory whitespace
__ = [ \t\r\n]+ {
    	return ""
}