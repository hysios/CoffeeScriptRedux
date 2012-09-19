/*
 * PEG.js 0.7.0
 *
 * http://pegjs.majda.cz/
 *
 * Copyright (c) 2010-2012 David Majda
 * Licensend under the MIT license.
 */
var PEG = (function(undefined) {

var PEG = {
  /* PEG.js version (uses semantic versioning). */
  VERSION: "0.7.0",

  /*
   * Generates a parser from a specified grammar and returns it.
   *
   * The grammar must be a string in the format described by the metagramar in
   * the parser.pegjs file.
   *
   * Throws |PEG.parser.SyntaxError| if the grammar contains a syntax error or
   * |PEG.GrammarError| if it contains a semantic error. Note that not all
   * errors are detected during the generation and some may protrude to the
   * generated parser and cause its malfunction.
   */
  buildParser: function(grammar, options) {
    return PEG.compiler.compile(PEG.parser.parse(grammar), options);
  }
};

/* Thrown when the grammar contains an error. */

PEG.GrammarError = function(message) {
  this.name = "PEG.GrammarError";
  this.message = message;
};

PEG.GrammarError.prototype = Error.prototype;

/* Like Python's |range|, but without |step|. */
function range(start, stop) {
  if (stop === undefined) {
    stop = start;
    start = 0;
  }

  var result = new Array(Math.max(0, stop - start));
  for (var i = 0, j = start; j < stop; i++, j++) {
    result[i] = j;
  }
  return result;
}

function find(array, callback) {
  var length = array.length;
  for (var i = 0; i < length; i++) {
    if (callback(array[i])) {
      return array[i];
    }
  }
}

function contains(array, value) {
  /*
   * Stupid IE does not have Array.prototype.indexOf, otherwise this function
   * would be a one-liner.
   */
  var length = array.length;
  for (var i = 0; i < length; i++) {
    if (array[i] === value) {
      return true;
    }
  }
  return false;
}

function each(array, callback) {
  var length = array.length;
  for (var i = 0; i < length; i++) {
    callback(array[i], i);
  }
}

function map(array, callback) {
  var result = [];
  var length = array.length;
  for (var i = 0; i < length; i++) {
    result[i] = callback(array[i], i);
  }
  return result;
}

function pluck(array, key) {
  return map(array, function (e) { return e[key]; });
}

function keys(object) {
  var result = [];
  for (var key in object) {
    result.push(key);
  }
  return result;
}

function values(object) {
  var result = [];
  for (var key in object) {
    result.push(object[key]);
  }
  return result;
}

/*
 * Returns a string padded on the left to a desired length with a character.
 *
 * The code needs to be in sync with the code template in the compilation
 * function for "action" nodes.
 */
function padLeft(input, padding, length) {
  var result = input;

  var padLength = length - input.length;
  for (var i = 0; i < padLength; i++) {
    result = padding + result;
  }

  return result;
}

/*
 * Returns an escape sequence for given character. Uses \x for characters <=
 * 0xFF to save space, \u for the rest.
 *
 * The code needs to be in sync with the code template in the compilation
 * function for "action" nodes.
 */
function escape(ch) {
  var charCode = ch.charCodeAt(0);
  var escapeChar;
  var length;

  if (charCode <= 0xFF) {
    escapeChar = 'x';
    length = 2;
  } else {
    escapeChar = 'u';
    length = 4;
  }

  return '\\' + escapeChar + padLeft(charCode.toString(16).toUpperCase(), '0', length);
}

/*
 * Surrounds the string with quotes and escapes characters inside so that the
 * result is a valid JavaScript string.
 *
 * The code needs to be in sync with the code template in the compilation
 * function for "action" nodes.
 */
function quote(s) {
  /*
   * ECMA-262, 5th ed., 7.8.4: All characters may appear literally in a string
   * literal except for the closing quote character, backslash, carriage return,
   * line separator, paragraph separator, and line feed. Any character may
   * appear in the form of an escape sequence.
   *
   * For portability, we also escape escape all control and non-ASCII
   * characters. Note that "\0" and "\v" escape sequences are not used because
   * JSHint does not like the first and IE the second.
   */
  return '"' + s
    .replace(/\\/g, '\\\\')  // backslash
    .replace(/"/g, '\\"')    // closing quote character
    .replace(/\x08/g, '\\b') // backspace
    .replace(/\t/g, '\\t')   // horizontal tab
    .replace(/\n/g, '\\n')   // line feed
    .replace(/\f/g, '\\f')   // form feed
    .replace(/\r/g, '\\r')   // carriage return
    .replace(/[\x00-\x07\x0B\x0E-\x1F\x80-\uFFFF]/g, escape)
    + '"';
}

/*
 * Escapes characters inside the string so that it can be used as a list of
 * characters in a character class of a regular expression.
 */
function quoteForRegexpClass(s) {
  /*
   * Based on ECMA-262, 5th ed., 7.8.5 & 15.10.1.
   *
   * For portability, we also escape escape all control and non-ASCII
   * characters.
   */
  return s
    .replace(/\\/g, '\\\\')  // backslash
    .replace(/\//g, '\\/')   // closing slash
    .replace(/\]/g, '\\]')   // closing bracket
    .replace(/-/g, '\\-')    // dash
    .replace(/\0/g, '\\0')   // null
    .replace(/\t/g, '\\t')   // horizontal tab
    .replace(/\n/g, '\\n')   // line feed
    .replace(/\v/g, '\\x0B') // vertical tab
    .replace(/\f/g, '\\f')   // form feed
    .replace(/\r/g, '\\r')   // carriage return
    .replace(/[\x01-\x08\x0E-\x1F\x80-\uFFFF]/g, escape);
}

/*
 * Builds a node visitor -- a function which takes a node and any number of
 * other parameters, calls an appropriate function according to the node type,
 * passes it all its parameters and returns its value. The functions for various
 * node types are passed in a parameter to |buildNodeVisitor| as a hash.
 */
function buildNodeVisitor(functions) {
  return function(node) {
    return functions[node.type].apply(null, arguments);
  };
}

function findRuleByName(ast, name) {
  return find(ast.rules, function(r) { return r.name === name; });
}
PEG.parser = (function(){
  /*
   * Generated by PEG.js 0.7.0.
   *
   * http://pegjs.majda.cz/
   */
  
  function quote(s) {
    /*
     * ECMA-262, 5th ed., 7.8.4: All characters may appear literally in a
     * string literal except for the closing quote character, backslash,
     * carriage return, line separator, paragraph separator, and line feed.
     * Any character may appear in the form of an escape sequence.
     *
     * For portability, we also escape escape all control and non-ASCII
     * characters. Note that "\0" and "\v" escape sequences are not used
     * because JSHint does not like the first and IE the second.
     */
     return '"' + s
      .replace(/\\/g, '\\\\')  // backslash
      .replace(/"/g, '\\"')    // closing quote character
      .replace(/\x08/g, '\\b') // backspace
      .replace(/\t/g, '\\t')   // horizontal tab
      .replace(/\n/g, '\\n')   // line feed
      .replace(/\f/g, '\\f')   // form feed
      .replace(/\r/g, '\\r')   // carriage return
      .replace(/[\x00-\x07\x0B\x0E-\x1F\x80-\uFFFF]/g, escape)
      + '"';
  }
  
  var result = {
    /*
     * Parses the input with a generated parser. If the parsing is successfull,
     * returns a value explicitly or implicitly specified by the grammar from
     * which the parser was generated (see |PEG.buildParser|). If the parsing is
     * unsuccessful, throws |PEG.parser.SyntaxError| describing the error.
     */
    parse: function(input, startRule) {
      var parseFunctions = {
        "grammar": parse_grammar,
        "initializer": parse_initializer,
        "rule": parse_rule,
        "choice": parse_choice,
        "sequence": parse_sequence,
        "labeled": parse_labeled,
        "prefixed": parse_prefixed,
        "suffixed": parse_suffixed,
        "primary": parse_primary,
        "action": parse_action,
        "braced": parse_braced,
        "nonBraceCharacters": parse_nonBraceCharacters,
        "nonBraceCharacter": parse_nonBraceCharacter,
        "equals": parse_equals,
        "colon": parse_colon,
        "semicolon": parse_semicolon,
        "slash": parse_slash,
        "and": parse_and,
        "not": parse_not,
        "question": parse_question,
        "star": parse_star,
        "plus": parse_plus,
        "lparen": parse_lparen,
        "rparen": parse_rparen,
        "dot": parse_dot,
        "identifier": parse_identifier,
        "literal": parse_literal,
        "string": parse_string,
        "doubleQuotedString": parse_doubleQuotedString,
        "doubleQuotedCharacter": parse_doubleQuotedCharacter,
        "simpleDoubleQuotedCharacter": parse_simpleDoubleQuotedCharacter,
        "singleQuotedString": parse_singleQuotedString,
        "singleQuotedCharacter": parse_singleQuotedCharacter,
        "simpleSingleQuotedCharacter": parse_simpleSingleQuotedCharacter,
        "class": parse_class,
        "classCharacterRange": parse_classCharacterRange,
        "classCharacter": parse_classCharacter,
        "bracketDelimitedCharacter": parse_bracketDelimitedCharacter,
        "simpleBracketDelimitedCharacter": parse_simpleBracketDelimitedCharacter,
        "simpleEscapeSequence": parse_simpleEscapeSequence,
        "zeroEscapeSequence": parse_zeroEscapeSequence,
        "hexEscapeSequence": parse_hexEscapeSequence,
        "unicodeEscapeSequence": parse_unicodeEscapeSequence,
        "eolEscapeSequence": parse_eolEscapeSequence,
        "digit": parse_digit,
        "hexDigit": parse_hexDigit,
        "letter": parse_letter,
        "lowerCaseLetter": parse_lowerCaseLetter,
        "upperCaseLetter": parse_upperCaseLetter,
        "__": parse___,
        "comment": parse_comment,
        "singleLineComment": parse_singleLineComment,
        "multiLineComment": parse_multiLineComment,
        "eol": parse_eol,
        "eolChar": parse_eolChar,
        "whitespace": parse_whitespace
      };
      
      if (startRule !== undefined) {
        if (parseFunctions[startRule] === undefined) {
          throw new Error("Invalid rule name: " + quote(startRule) + ".");
        }
      } else {
        startRule = "grammar";
      }
      
      var pos = 0;
      var reportFailures = 0;
      var rightmostFailuresPos = 0;
      var rightmostFailuresExpected = [];
      
      function padLeft(input, padding, length) {
        var result = input;
        
        var padLength = length - input.length;
        for (var i = 0; i < padLength; i++) {
          result = padding + result;
        }
        
        return result;
      }
      
      function escape(ch) {
        var charCode = ch.charCodeAt(0);
        var escapeChar;
        var length;
        
        if (charCode <= 0xFF) {
          escapeChar = 'x';
          length = 2;
        } else {
          escapeChar = 'u';
          length = 4;
        }
        
        return '\\' + escapeChar + padLeft(charCode.toString(16).toUpperCase(), '0', length);
      }
      
      function matchFailed(failure) {
        if (pos < rightmostFailuresPos) {
          return;
        }
        
        if (pos > rightmostFailuresPos) {
          rightmostFailuresPos = pos;
          rightmostFailuresExpected = [];
        }
        
        rightmostFailuresExpected.push(failure);
      }
      
      function parse_grammar() {
        var r0, r1, r2, r3, r4, r5, r6;
        
        r1 = pos;
        r2 = pos;
        r3 = parse___();
        if (r3 !== null) {
          r4 = parse_initializer();
          r4 = r4 !== null ? r4 : "";
          if (r4 !== null) {
            r6 = parse_rule();
            if (r6 !== null) {
              r5 = [];
              while (r6 !== null) {
                r5.push(r6);
                r6 = parse_rule();
              }
            } else {
              r5 = null;
            }
            if (r5 !== null) {
              r0 = [r3, r4, r5];
            } else {
              r0 = null;
              pos = r2;
            }
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, initializer, rules) {
              return {
                type:        "grammar",
                initializer: initializer !== "" ? initializer : null,
                rules:       rules,
                startRule:   rules[0].name
              };
            })(r1, r4, r5);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_initializer() {
        var r0, r1, r2, r3, r4;
        
        r1 = pos;
        r2 = pos;
        r3 = parse_action();
        if (r3 !== null) {
          r4 = parse_semicolon();
          r4 = r4 !== null ? r4 : "";
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, code) {
              return {
                type: "initializer",
                code: code
              };
            })(r1, r3);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_rule() {
        var r0, r1, r2, r3, r4, r5, r6, r7;
        
        r1 = pos;
        r2 = pos;
        r3 = parse_identifier();
        if (r3 !== null) {
          r4 = parse_string();
          r4 = r4 !== null ? r4 : "";
          if (r4 !== null) {
            r5 = parse_equals();
            if (r5 !== null) {
              r6 = parse_choice();
              if (r6 !== null) {
                r7 = parse_semicolon();
                r7 = r7 !== null ? r7 : "";
                if (r7 !== null) {
                  r0 = [r3, r4, r5, r6, r7];
                } else {
                  r0 = null;
                  pos = r2;
                }
              } else {
                r0 = null;
                pos = r2;
              }
            } else {
              r0 = null;
              pos = r2;
            }
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, name, displayName, expression) {
              return {
                type:        "rule",
                name:        name,
                expression:  displayName !== ""
                  ? {
                      type:       "named",
                      name:       displayName,
                      expression: expression
                    }
                  : expression
              };
            })(r1, r3, r4, r6);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_choice() {
        var r0, r1, r2, r3, r4, r5, r6, r7, r8;
        
        r1 = pos;
        r2 = pos;
        r3 = parse_sequence();
        if (r3 !== null) {
          r4 = [];
          r6 = pos;
          r7 = parse_slash();
          if (r7 !== null) {
            r8 = parse_sequence();
            if (r8 !== null) {
              r5 = [r7, r8];
            } else {
              r5 = null;
              pos = r6;
            }
          } else {
            r5 = null;
            pos = r6;
          }
          while (r5 !== null) {
            r4.push(r5);
            r6 = pos;
            r7 = parse_slash();
            if (r7 !== null) {
              r8 = parse_sequence();
              if (r8 !== null) {
                r5 = [r7, r8];
              } else {
                r5 = null;
                pos = r6;
              }
            } else {
              r5 = null;
              pos = r6;
            }
          }
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, head, tail) {
              if (tail.length > 0) {
                var alternatives = [head].concat(map(
                    tail,
                    function(element) { return element[1]; }
                ));
                return {
                  type:         "choice",
                  alternatives: alternatives
                };
              } else {
                return head;
              }
            })(r1, r3, r4);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_sequence() {
        var r0, r1, r2, r3, r4;
        
        r1 = pos;
        r2 = pos;
        r3 = [];
        r4 = parse_labeled();
        while (r4 !== null) {
          r3.push(r4);
          r4 = parse_labeled();
        }
        if (r3 !== null) {
          r4 = parse_action();
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, elements, code) {
              var expression = elements.length !== 1
                ? {
                    type:     "sequence",
                    elements: elements
                  }
                : elements[0];
              return {
                type:       "action",
                expression: expression,
                code:       code
              };
            })(r1, r3, r4);
        }
        if (r0 === null) {
          pos = r1;
        }
        if (r0 === null) {
          r1 = pos;
          r0 = [];
          r2 = parse_labeled();
          while (r2 !== null) {
            r0.push(r2);
            r2 = parse_labeled();
          }
          if (r0 !== null) {
            r0 = (function(offset, elements) {
                return elements.length !== 1
                  ? {
                      type:     "sequence",
                      elements: elements
                    }
                  : elements[0];
              })(r1, r0);
          }
          if (r0 === null) {
            pos = r1;
          }
        }
        return r0;
      }
      
      function parse_labeled() {
        var r0, r1, r2, r3, r4, r5;
        
        r1 = pos;
        r2 = pos;
        r3 = parse_identifier();
        if (r3 !== null) {
          r4 = parse_colon();
          if (r4 !== null) {
            r5 = parse_prefixed();
            if (r5 !== null) {
              r0 = [r3, r4, r5];
            } else {
              r0 = null;
              pos = r2;
            }
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, label, expression) {
              return {
                type:       "labeled",
                label:      label,
                expression: expression
              };
            })(r1, r3, r5);
        }
        if (r0 === null) {
          pos = r1;
        }
        if (r0 === null) {
          r0 = parse_prefixed();
        }
        return r0;
      }
      
      function parse_prefixed() {
        var r0, r1, r2, r3, r4;
        
        r1 = pos;
        r2 = pos;
        r3 = parse_and();
        if (r3 !== null) {
          r4 = parse_action();
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, code) {
              return {
                type: "semantic_and",
                code: code
              };
            })(r1, r4);
        }
        if (r0 === null) {
          pos = r1;
        }
        if (r0 === null) {
          r1 = pos;
          r2 = pos;
          r3 = parse_and();
          if (r3 !== null) {
            r4 = parse_suffixed();
            if (r4 !== null) {
              r0 = [r3, r4];
            } else {
              r0 = null;
              pos = r2;
            }
          } else {
            r0 = null;
            pos = r2;
          }
          if (r0 !== null) {
            r0 = (function(offset, expression) {
                return {
                  type:       "simple_and",
                  expression: expression
                };
              })(r1, r4);
          }
          if (r0 === null) {
            pos = r1;
          }
          if (r0 === null) {
            r1 = pos;
            r2 = pos;
            r3 = parse_not();
            if (r3 !== null) {
              r4 = parse_action();
              if (r4 !== null) {
                r0 = [r3, r4];
              } else {
                r0 = null;
                pos = r2;
              }
            } else {
              r0 = null;
              pos = r2;
            }
            if (r0 !== null) {
              r0 = (function(offset, code) {
                  return {
                    type: "semantic_not",
                    code: code
                  };
                })(r1, r4);
            }
            if (r0 === null) {
              pos = r1;
            }
            if (r0 === null) {
              r1 = pos;
              r2 = pos;
              r3 = parse_not();
              if (r3 !== null) {
                r4 = parse_suffixed();
                if (r4 !== null) {
                  r0 = [r3, r4];
                } else {
                  r0 = null;
                  pos = r2;
                }
              } else {
                r0 = null;
                pos = r2;
              }
              if (r0 !== null) {
                r0 = (function(offset, expression) {
                    return {
                      type:       "simple_not",
                      expression: expression
                    };
                  })(r1, r4);
              }
              if (r0 === null) {
                pos = r1;
              }
              if (r0 === null) {
                r0 = parse_suffixed();
              }
            }
          }
        }
        return r0;
      }
      
      function parse_suffixed() {
        var r0, r1, r2, r3, r4;
        
        r1 = pos;
        r2 = pos;
        r3 = parse_primary();
        if (r3 !== null) {
          r4 = parse_question();
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, expression) {
              return {
                type:       "optional",
                expression: expression
              };
            })(r1, r3);
        }
        if (r0 === null) {
          pos = r1;
        }
        if (r0 === null) {
          r1 = pos;
          r2 = pos;
          r3 = parse_primary();
          if (r3 !== null) {
            r4 = parse_star();
            if (r4 !== null) {
              r0 = [r3, r4];
            } else {
              r0 = null;
              pos = r2;
            }
          } else {
            r0 = null;
            pos = r2;
          }
          if (r0 !== null) {
            r0 = (function(offset, expression) {
                return {
                  type:       "zero_or_more",
                  expression: expression
                };
              })(r1, r3);
          }
          if (r0 === null) {
            pos = r1;
          }
          if (r0 === null) {
            r1 = pos;
            r2 = pos;
            r3 = parse_primary();
            if (r3 !== null) {
              r4 = parse_plus();
              if (r4 !== null) {
                r0 = [r3, r4];
              } else {
                r0 = null;
                pos = r2;
              }
            } else {
              r0 = null;
              pos = r2;
            }
            if (r0 !== null) {
              r0 = (function(offset, expression) {
                  return {
                    type:       "one_or_more",
                    expression: expression
                  };
                })(r1, r3);
            }
            if (r0 === null) {
              pos = r1;
            }
            if (r0 === null) {
              r0 = parse_primary();
            }
          }
        }
        return r0;
      }
      
      function parse_primary() {
        var r0, r1, r2, r3, r4, r5, r6, r7, r8;
        
        r1 = pos;
        r2 = pos;
        r3 = parse_identifier();
        if (r3 !== null) {
          r5 = pos;
          reportFailures++;
          r6 = pos;
          r7 = parse_string();
          r7 = r7 !== null ? r7 : "";
          if (r7 !== null) {
            r8 = parse_equals();
            if (r8 !== null) {
              r4 = [r7, r8];
            } else {
              r4 = null;
              pos = r6;
            }
          } else {
            r4 = null;
            pos = r6;
          }
          reportFailures--;
          if (r4 === null) {
            r4 = "";
          } else {
            r4 = null;
            pos = r5;
          }
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, name) {
              return {
                type: "rule_ref",
                name: name
              };
            })(r1, r3);
        }
        if (r0 === null) {
          pos = r1;
        }
        if (r0 === null) {
          r0 = parse_literal();
          if (r0 === null) {
            r0 = parse_class();
            if (r0 === null) {
              r1 = pos;
              r0 = parse_dot();
              if (r0 !== null) {
                r0 = (function(offset) { return { type: "any" }; })(r1);
              }
              if (r0 === null) {
                pos = r1;
              }
              if (r0 === null) {
                r1 = pos;
                r2 = pos;
                r3 = parse_lparen();
                if (r3 !== null) {
                  r4 = parse_choice();
                  if (r4 !== null) {
                    r5 = parse_rparen();
                    if (r5 !== null) {
                      r0 = [r3, r4, r5];
                    } else {
                      r0 = null;
                      pos = r2;
                    }
                  } else {
                    r0 = null;
                    pos = r2;
                  }
                } else {
                  r0 = null;
                  pos = r2;
                }
                if (r0 !== null) {
                  r0 = (function(offset, expression) { return expression; })(r1, r4);
                }
                if (r0 === null) {
                  pos = r1;
                }
              }
            }
          }
        }
        return r0;
      }
      
      function parse_action() {
        var r0, r1, r2, r3, r4;
        
        reportFailures++;
        r1 = pos;
        r2 = pos;
        r3 = parse_braced();
        if (r3 !== null) {
          r4 = parse___();
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, braced) { return braced.substr(1, braced.length - 2); })(r1, r3);
        }
        if (r0 === null) {
          pos = r1;
        }
        reportFailures--;
        if (reportFailures === 0 && r0 === null) {
          matchFailed("action");
        }
        return r0;
      }
      
      function parse_braced() {
        var r0, r1, r2, r3, r4, r5;
        
        r1 = pos;
        r2 = pos;
        if (input.charCodeAt(pos) === 123) {
          r3 = "{";
          pos++;
        } else {
          r3 = null;
          if (reportFailures === 0) {
            matchFailed("\"{\"");
          }
        }
        if (r3 !== null) {
          r4 = [];
          r5 = parse_braced();
          if (r5 === null) {
            r5 = parse_nonBraceCharacters();
          }
          while (r5 !== null) {
            r4.push(r5);
            r5 = parse_braced();
            if (r5 === null) {
              r5 = parse_nonBraceCharacters();
            }
          }
          if (r4 !== null) {
            if (input.charCodeAt(pos) === 125) {
              r5 = "}";
              pos++;
            } else {
              r5 = null;
              if (reportFailures === 0) {
                matchFailed("\"}\"");
              }
            }
            if (r5 !== null) {
              r0 = [r3, r4, r5];
            } else {
              r0 = null;
              pos = r2;
            }
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, parts) {
              return "{" + parts.join("") + "}";
            })(r1, r4);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_nonBraceCharacters() {
        var r0, r1, r2;
        
        r1 = pos;
        r2 = parse_nonBraceCharacter();
        if (r2 !== null) {
          r0 = [];
          while (r2 !== null) {
            r0.push(r2);
            r2 = parse_nonBraceCharacter();
          }
        } else {
          r0 = null;
        }
        if (r0 !== null) {
          r0 = (function(offset, chars) { return chars.join(""); })(r1, r0);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_nonBraceCharacter() {
        var r0;
        
        if (/^[^{}]/.test(input.charAt(pos))) {
          r0 = input.charAt(pos);
          pos++;
        } else {
          r0 = null;
          if (reportFailures === 0) {
            matchFailed("[^{}]");
          }
        }
        return r0;
      }
      
      function parse_equals() {
        var r0, r1, r2, r3, r4;
        
        r1 = pos;
        r2 = pos;
        if (input.charCodeAt(pos) === 61) {
          r3 = "=";
          pos++;
        } else {
          r3 = null;
          if (reportFailures === 0) {
            matchFailed("\"=\"");
          }
        }
        if (r3 !== null) {
          r4 = parse___();
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset) { return "="; })(r1);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_colon() {
        var r0, r1, r2, r3, r4;
        
        r1 = pos;
        r2 = pos;
        if (input.charCodeAt(pos) === 58) {
          r3 = ":";
          pos++;
        } else {
          r3 = null;
          if (reportFailures === 0) {
            matchFailed("\":\"");
          }
        }
        if (r3 !== null) {
          r4 = parse___();
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset) { return ":"; })(r1);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_semicolon() {
        var r0, r1, r2, r3, r4;
        
        r1 = pos;
        r2 = pos;
        if (input.charCodeAt(pos) === 59) {
          r3 = ";";
          pos++;
        } else {
          r3 = null;
          if (reportFailures === 0) {
            matchFailed("\";\"");
          }
        }
        if (r3 !== null) {
          r4 = parse___();
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset) { return ";"; })(r1);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_slash() {
        var r0, r1, r2, r3, r4;
        
        r1 = pos;
        r2 = pos;
        if (input.charCodeAt(pos) === 47) {
          r3 = "/";
          pos++;
        } else {
          r3 = null;
          if (reportFailures === 0) {
            matchFailed("\"/\"");
          }
        }
        if (r3 !== null) {
          r4 = parse___();
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset) { return "/"; })(r1);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_and() {
        var r0, r1, r2, r3, r4;
        
        r1 = pos;
        r2 = pos;
        if (input.charCodeAt(pos) === 38) {
          r3 = "&";
          pos++;
        } else {
          r3 = null;
          if (reportFailures === 0) {
            matchFailed("\"&\"");
          }
        }
        if (r3 !== null) {
          r4 = parse___();
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset) { return "&"; })(r1);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_not() {
        var r0, r1, r2, r3, r4;
        
        r1 = pos;
        r2 = pos;
        if (input.charCodeAt(pos) === 33) {
          r3 = "!";
          pos++;
        } else {
          r3 = null;
          if (reportFailures === 0) {
            matchFailed("\"!\"");
          }
        }
        if (r3 !== null) {
          r4 = parse___();
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset) { return "!"; })(r1);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_question() {
        var r0, r1, r2, r3, r4;
        
        r1 = pos;
        r2 = pos;
        if (input.charCodeAt(pos) === 63) {
          r3 = "?";
          pos++;
        } else {
          r3 = null;
          if (reportFailures === 0) {
            matchFailed("\"?\"");
          }
        }
        if (r3 !== null) {
          r4 = parse___();
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset) { return "?"; })(r1);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_star() {
        var r0, r1, r2, r3, r4;
        
        r1 = pos;
        r2 = pos;
        if (input.charCodeAt(pos) === 42) {
          r3 = "*";
          pos++;
        } else {
          r3 = null;
          if (reportFailures === 0) {
            matchFailed("\"*\"");
          }
        }
        if (r3 !== null) {
          r4 = parse___();
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset) { return "*"; })(r1);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_plus() {
        var r0, r1, r2, r3, r4;
        
        r1 = pos;
        r2 = pos;
        if (input.charCodeAt(pos) === 43) {
          r3 = "+";
          pos++;
        } else {
          r3 = null;
          if (reportFailures === 0) {
            matchFailed("\"+\"");
          }
        }
        if (r3 !== null) {
          r4 = parse___();
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset) { return "+"; })(r1);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_lparen() {
        var r0, r1, r2, r3, r4;
        
        r1 = pos;
        r2 = pos;
        if (input.charCodeAt(pos) === 40) {
          r3 = "(";
          pos++;
        } else {
          r3 = null;
          if (reportFailures === 0) {
            matchFailed("\"(\"");
          }
        }
        if (r3 !== null) {
          r4 = parse___();
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset) { return "("; })(r1);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_rparen() {
        var r0, r1, r2, r3, r4;
        
        r1 = pos;
        r2 = pos;
        if (input.charCodeAt(pos) === 41) {
          r3 = ")";
          pos++;
        } else {
          r3 = null;
          if (reportFailures === 0) {
            matchFailed("\")\"");
          }
        }
        if (r3 !== null) {
          r4 = parse___();
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset) { return ")"; })(r1);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_dot() {
        var r0, r1, r2, r3, r4;
        
        r1 = pos;
        r2 = pos;
        if (input.charCodeAt(pos) === 46) {
          r3 = ".";
          pos++;
        } else {
          r3 = null;
          if (reportFailures === 0) {
            matchFailed("\".\"");
          }
        }
        if (r3 !== null) {
          r4 = parse___();
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset) { return "."; })(r1);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_identifier() {
        var r0, r1, r2, r3, r4, r5;
        
        reportFailures++;
        r1 = pos;
        r2 = pos;
        r3 = parse_letter();
        if (r3 === null) {
          if (input.charCodeAt(pos) === 95) {
            r3 = "_";
            pos++;
          } else {
            r3 = null;
            if (reportFailures === 0) {
              matchFailed("\"_\"");
            }
          }
          if (r3 === null) {
            if (input.charCodeAt(pos) === 36) {
              r3 = "$";
              pos++;
            } else {
              r3 = null;
              if (reportFailures === 0) {
                matchFailed("\"$\"");
              }
            }
          }
        }
        if (r3 !== null) {
          r4 = [];
          r5 = parse_letter();
          if (r5 === null) {
            r5 = parse_digit();
            if (r5 === null) {
              if (input.charCodeAt(pos) === 95) {
                r5 = "_";
                pos++;
              } else {
                r5 = null;
                if (reportFailures === 0) {
                  matchFailed("\"_\"");
                }
              }
              if (r5 === null) {
                if (input.charCodeAt(pos) === 36) {
                  r5 = "$";
                  pos++;
                } else {
                  r5 = null;
                  if (reportFailures === 0) {
                    matchFailed("\"$\"");
                  }
                }
              }
            }
          }
          while (r5 !== null) {
            r4.push(r5);
            r5 = parse_letter();
            if (r5 === null) {
              r5 = parse_digit();
              if (r5 === null) {
                if (input.charCodeAt(pos) === 95) {
                  r5 = "_";
                  pos++;
                } else {
                  r5 = null;
                  if (reportFailures === 0) {
                    matchFailed("\"_\"");
                  }
                }
                if (r5 === null) {
                  if (input.charCodeAt(pos) === 36) {
                    r5 = "$";
                    pos++;
                  } else {
                    r5 = null;
                    if (reportFailures === 0) {
                      matchFailed("\"$\"");
                    }
                  }
                }
              }
            }
          }
          if (r4 !== null) {
            r5 = parse___();
            if (r5 !== null) {
              r0 = [r3, r4, r5];
            } else {
              r0 = null;
              pos = r2;
            }
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, head, tail) {
              return head + tail.join("");
            })(r1, r3, r4);
        }
        if (r0 === null) {
          pos = r1;
        }
        reportFailures--;
        if (reportFailures === 0 && r0 === null) {
          matchFailed("identifier");
        }
        return r0;
      }
      
      function parse_literal() {
        var r0, r1, r2, r3, r4, r5;
        
        reportFailures++;
        r1 = pos;
        r2 = pos;
        r3 = parse_doubleQuotedString();
        if (r3 === null) {
          r3 = parse_singleQuotedString();
        }
        if (r3 !== null) {
          if (input.charCodeAt(pos) === 105) {
            r4 = "i";
            pos++;
          } else {
            r4 = null;
            if (reportFailures === 0) {
              matchFailed("\"i\"");
            }
          }
          r4 = r4 !== null ? r4 : "";
          if (r4 !== null) {
            r5 = parse___();
            if (r5 !== null) {
              r0 = [r3, r4, r5];
            } else {
              r0 = null;
              pos = r2;
            }
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, value, flags) {
              return {
                type:       "literal",
                value:      value,
                ignoreCase: flags === "i"
              };
            })(r1, r3, r4);
        }
        if (r0 === null) {
          pos = r1;
        }
        reportFailures--;
        if (reportFailures === 0 && r0 === null) {
          matchFailed("literal");
        }
        return r0;
      }
      
      function parse_string() {
        var r0, r1, r2, r3, r4;
        
        reportFailures++;
        r1 = pos;
        r2 = pos;
        r3 = parse_doubleQuotedString();
        if (r3 === null) {
          r3 = parse_singleQuotedString();
        }
        if (r3 !== null) {
          r4 = parse___();
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, string) { return string; })(r1, r3);
        }
        if (r0 === null) {
          pos = r1;
        }
        reportFailures--;
        if (reportFailures === 0 && r0 === null) {
          matchFailed("string");
        }
        return r0;
      }
      
      function parse_doubleQuotedString() {
        var r0, r1, r2, r3, r4, r5;
        
        r1 = pos;
        r2 = pos;
        if (input.charCodeAt(pos) === 34) {
          r3 = "\"";
          pos++;
        } else {
          r3 = null;
          if (reportFailures === 0) {
            matchFailed("\"\\\"\"");
          }
        }
        if (r3 !== null) {
          r4 = [];
          r5 = parse_doubleQuotedCharacter();
          while (r5 !== null) {
            r4.push(r5);
            r5 = parse_doubleQuotedCharacter();
          }
          if (r4 !== null) {
            if (input.charCodeAt(pos) === 34) {
              r5 = "\"";
              pos++;
            } else {
              r5 = null;
              if (reportFailures === 0) {
                matchFailed("\"\\\"\"");
              }
            }
            if (r5 !== null) {
              r0 = [r3, r4, r5];
            } else {
              r0 = null;
              pos = r2;
            }
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, chars) { return chars.join(""); })(r1, r4);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_doubleQuotedCharacter() {
        var r0;
        
        r0 = parse_simpleDoubleQuotedCharacter();
        if (r0 === null) {
          r0 = parse_simpleEscapeSequence();
          if (r0 === null) {
            r0 = parse_zeroEscapeSequence();
            if (r0 === null) {
              r0 = parse_hexEscapeSequence();
              if (r0 === null) {
                r0 = parse_unicodeEscapeSequence();
                if (r0 === null) {
                  r0 = parse_eolEscapeSequence();
                }
              }
            }
          }
        }
        return r0;
      }
      
      function parse_simpleDoubleQuotedCharacter() {
        var r0, r1, r2, r3, r4;
        
        r1 = pos;
        r2 = pos;
        r4 = pos;
        reportFailures++;
        if (input.charCodeAt(pos) === 34) {
          r3 = "\"";
          pos++;
        } else {
          r3 = null;
          if (reportFailures === 0) {
            matchFailed("\"\\\"\"");
          }
        }
        if (r3 === null) {
          if (input.charCodeAt(pos) === 92) {
            r3 = "\\";
            pos++;
          } else {
            r3 = null;
            if (reportFailures === 0) {
              matchFailed("\"\\\\\"");
            }
          }
          if (r3 === null) {
            r3 = parse_eolChar();
          }
        }
        reportFailures--;
        if (r3 === null) {
          r3 = "";
        } else {
          r3 = null;
          pos = r4;
        }
        if (r3 !== null) {
          if (input.length > pos) {
            r4 = input.charAt(pos);
            pos++;
          } else {
            r4 = null;
            if (reportFailures === 0) {
              matchFailed("any character");
            }
          }
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, char_) { return char_; })(r1, r4);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_singleQuotedString() {
        var r0, r1, r2, r3, r4, r5;
        
        r1 = pos;
        r2 = pos;
        if (input.charCodeAt(pos) === 39) {
          r3 = "'";
          pos++;
        } else {
          r3 = null;
          if (reportFailures === 0) {
            matchFailed("\"'\"");
          }
        }
        if (r3 !== null) {
          r4 = [];
          r5 = parse_singleQuotedCharacter();
          while (r5 !== null) {
            r4.push(r5);
            r5 = parse_singleQuotedCharacter();
          }
          if (r4 !== null) {
            if (input.charCodeAt(pos) === 39) {
              r5 = "'";
              pos++;
            } else {
              r5 = null;
              if (reportFailures === 0) {
                matchFailed("\"'\"");
              }
            }
            if (r5 !== null) {
              r0 = [r3, r4, r5];
            } else {
              r0 = null;
              pos = r2;
            }
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, chars) { return chars.join(""); })(r1, r4);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_singleQuotedCharacter() {
        var r0;
        
        r0 = parse_simpleSingleQuotedCharacter();
        if (r0 === null) {
          r0 = parse_simpleEscapeSequence();
          if (r0 === null) {
            r0 = parse_zeroEscapeSequence();
            if (r0 === null) {
              r0 = parse_hexEscapeSequence();
              if (r0 === null) {
                r0 = parse_unicodeEscapeSequence();
                if (r0 === null) {
                  r0 = parse_eolEscapeSequence();
                }
              }
            }
          }
        }
        return r0;
      }
      
      function parse_simpleSingleQuotedCharacter() {
        var r0, r1, r2, r3, r4;
        
        r1 = pos;
        r2 = pos;
        r4 = pos;
        reportFailures++;
        if (input.charCodeAt(pos) === 39) {
          r3 = "'";
          pos++;
        } else {
          r3 = null;
          if (reportFailures === 0) {
            matchFailed("\"'\"");
          }
        }
        if (r3 === null) {
          if (input.charCodeAt(pos) === 92) {
            r3 = "\\";
            pos++;
          } else {
            r3 = null;
            if (reportFailures === 0) {
              matchFailed("\"\\\\\"");
            }
          }
          if (r3 === null) {
            r3 = parse_eolChar();
          }
        }
        reportFailures--;
        if (r3 === null) {
          r3 = "";
        } else {
          r3 = null;
          pos = r4;
        }
        if (r3 !== null) {
          if (input.length > pos) {
            r4 = input.charAt(pos);
            pos++;
          } else {
            r4 = null;
            if (reportFailures === 0) {
              matchFailed("any character");
            }
          }
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, char_) { return char_; })(r1, r4);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_class() {
        var r0, r1, r2, r3, r4, r5, r6, r7, r8;
        
        reportFailures++;
        r1 = pos;
        r2 = pos;
        if (input.charCodeAt(pos) === 91) {
          r3 = "[";
          pos++;
        } else {
          r3 = null;
          if (reportFailures === 0) {
            matchFailed("\"[\"");
          }
        }
        if (r3 !== null) {
          if (input.charCodeAt(pos) === 94) {
            r4 = "^";
            pos++;
          } else {
            r4 = null;
            if (reportFailures === 0) {
              matchFailed("\"^\"");
            }
          }
          r4 = r4 !== null ? r4 : "";
          if (r4 !== null) {
            r5 = [];
            r6 = parse_classCharacterRange();
            if (r6 === null) {
              r6 = parse_classCharacter();
            }
            while (r6 !== null) {
              r5.push(r6);
              r6 = parse_classCharacterRange();
              if (r6 === null) {
                r6 = parse_classCharacter();
              }
            }
            if (r5 !== null) {
              if (input.charCodeAt(pos) === 93) {
                r6 = "]";
                pos++;
              } else {
                r6 = null;
                if (reportFailures === 0) {
                  matchFailed("\"]\"");
                }
              }
              if (r6 !== null) {
                if (input.charCodeAt(pos) === 105) {
                  r7 = "i";
                  pos++;
                } else {
                  r7 = null;
                  if (reportFailures === 0) {
                    matchFailed("\"i\"");
                  }
                }
                r7 = r7 !== null ? r7 : "";
                if (r7 !== null) {
                  r8 = parse___();
                  if (r8 !== null) {
                    r0 = [r3, r4, r5, r6, r7, r8];
                  } else {
                    r0 = null;
                    pos = r2;
                  }
                } else {
                  r0 = null;
                  pos = r2;
                }
              } else {
                r0 = null;
                pos = r2;
              }
            } else {
              r0 = null;
              pos = r2;
            }
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, inverted, parts, flags) {
              var partsConverted = map(parts, function(part) { return part.data; });
              var rawText = "["
                + inverted
                + map(parts, function(part) { return part.rawText; }).join("")
                + "]"
                + flags;
        
              return {
                type:       "class",
                parts:      partsConverted,
                // FIXME: Get the raw text from the input directly.
                rawText:    rawText,
                inverted:   inverted === "^",
                ignoreCase: flags === "i"
              };
            })(r1, r4, r5, r7);
        }
        if (r0 === null) {
          pos = r1;
        }
        reportFailures--;
        if (reportFailures === 0 && r0 === null) {
          matchFailed("character class");
        }
        return r0;
      }
      
      function parse_classCharacterRange() {
        var r0, r1, r2, r3, r4, r5;
        
        r1 = pos;
        r2 = pos;
        r3 = parse_classCharacter();
        if (r3 !== null) {
          if (input.charCodeAt(pos) === 45) {
            r4 = "-";
            pos++;
          } else {
            r4 = null;
            if (reportFailures === 0) {
              matchFailed("\"-\"");
            }
          }
          if (r4 !== null) {
            r5 = parse_classCharacter();
            if (r5 !== null) {
              r0 = [r3, r4, r5];
            } else {
              r0 = null;
              pos = r2;
            }
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, begin, end) {
              if (begin.data.charCodeAt(0) > end.data.charCodeAt(0)) {
                throw new this.SyntaxError(
                  "Invalid character range: " + begin.rawText + "-" + end.rawText + "."
                );
              }
        
              return {
                data:    [begin.data, end.data],
                // FIXME: Get the raw text from the input directly.
                rawText: begin.rawText + "-" + end.rawText
              };
            })(r1, r3, r5);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_classCharacter() {
        var r0, r1;
        
        r1 = pos;
        r0 = parse_bracketDelimitedCharacter();
        if (r0 !== null) {
          r0 = (function(offset, char_) {
              return {
                data:    char_,
                // FIXME: Get the raw text from the input directly.
                rawText: quoteForRegexpClass(char_)
              };
            })(r1, r0);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_bracketDelimitedCharacter() {
        var r0;
        
        r0 = parse_simpleBracketDelimitedCharacter();
        if (r0 === null) {
          r0 = parse_simpleEscapeSequence();
          if (r0 === null) {
            r0 = parse_zeroEscapeSequence();
            if (r0 === null) {
              r0 = parse_hexEscapeSequence();
              if (r0 === null) {
                r0 = parse_unicodeEscapeSequence();
                if (r0 === null) {
                  r0 = parse_eolEscapeSequence();
                }
              }
            }
          }
        }
        return r0;
      }
      
      function parse_simpleBracketDelimitedCharacter() {
        var r0, r1, r2, r3, r4;
        
        r1 = pos;
        r2 = pos;
        r4 = pos;
        reportFailures++;
        if (input.charCodeAt(pos) === 93) {
          r3 = "]";
          pos++;
        } else {
          r3 = null;
          if (reportFailures === 0) {
            matchFailed("\"]\"");
          }
        }
        if (r3 === null) {
          if (input.charCodeAt(pos) === 92) {
            r3 = "\\";
            pos++;
          } else {
            r3 = null;
            if (reportFailures === 0) {
              matchFailed("\"\\\\\"");
            }
          }
          if (r3 === null) {
            r3 = parse_eolChar();
          }
        }
        reportFailures--;
        if (r3 === null) {
          r3 = "";
        } else {
          r3 = null;
          pos = r4;
        }
        if (r3 !== null) {
          if (input.length > pos) {
            r4 = input.charAt(pos);
            pos++;
          } else {
            r4 = null;
            if (reportFailures === 0) {
              matchFailed("any character");
            }
          }
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, char_) { return char_; })(r1, r4);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_simpleEscapeSequence() {
        var r0, r1, r2, r3, r4, r5;
        
        r1 = pos;
        r2 = pos;
        if (input.charCodeAt(pos) === 92) {
          r3 = "\\";
          pos++;
        } else {
          r3 = null;
          if (reportFailures === 0) {
            matchFailed("\"\\\\\"");
          }
        }
        if (r3 !== null) {
          r5 = pos;
          reportFailures++;
          r4 = parse_digit();
          if (r4 === null) {
            if (input.charCodeAt(pos) === 120) {
              r4 = "x";
              pos++;
            } else {
              r4 = null;
              if (reportFailures === 0) {
                matchFailed("\"x\"");
              }
            }
            if (r4 === null) {
              if (input.charCodeAt(pos) === 117) {
                r4 = "u";
                pos++;
              } else {
                r4 = null;
                if (reportFailures === 0) {
                  matchFailed("\"u\"");
                }
              }
              if (r4 === null) {
                r4 = parse_eolChar();
              }
            }
          }
          reportFailures--;
          if (r4 === null) {
            r4 = "";
          } else {
            r4 = null;
            pos = r5;
          }
          if (r4 !== null) {
            if (input.length > pos) {
              r5 = input.charAt(pos);
              pos++;
            } else {
              r5 = null;
              if (reportFailures === 0) {
                matchFailed("any character");
              }
            }
            if (r5 !== null) {
              r0 = [r3, r4, r5];
            } else {
              r0 = null;
              pos = r2;
            }
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, char_) {
              return char_
                .replace("b", "\b")
                .replace("f", "\f")
                .replace("n", "\n")
                .replace("r", "\r")
                .replace("t", "\t")
                .replace("v", "\x0B"); // IE does not recognize "\v".
            })(r1, r5);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_zeroEscapeSequence() {
        var r0, r1, r2, r3, r4, r5;
        
        r1 = pos;
        r2 = pos;
        if (input.substr(pos, 2) === "\\0") {
          r3 = "\\0";
          pos += 2;
        } else {
          r3 = null;
          if (reportFailures === 0) {
            matchFailed("\"\\\\0\"");
          }
        }
        if (r3 !== null) {
          r5 = pos;
          reportFailures++;
          r4 = parse_digit();
          reportFailures--;
          if (r4 === null) {
            r4 = "";
          } else {
            r4 = null;
            pos = r5;
          }
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset) { return "\x00"; })(r1);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_hexEscapeSequence() {
        var r0, r1, r2, r3, r4, r5;
        
        r1 = pos;
        r2 = pos;
        if (input.substr(pos, 2) === "\\x") {
          r3 = "\\x";
          pos += 2;
        } else {
          r3 = null;
          if (reportFailures === 0) {
            matchFailed("\"\\\\x\"");
          }
        }
        if (r3 !== null) {
          r4 = parse_hexDigit();
          if (r4 !== null) {
            r5 = parse_hexDigit();
            if (r5 !== null) {
              r0 = [r3, r4, r5];
            } else {
              r0 = null;
              pos = r2;
            }
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, h1, h2) {
              return String.fromCharCode(parseInt(h1 + h2, 16));
            })(r1, r4, r5);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_unicodeEscapeSequence() {
        var r0, r1, r2, r3, r4, r5, r6, r7;
        
        r1 = pos;
        r2 = pos;
        if (input.substr(pos, 2) === "\\u") {
          r3 = "\\u";
          pos += 2;
        } else {
          r3 = null;
          if (reportFailures === 0) {
            matchFailed("\"\\\\u\"");
          }
        }
        if (r3 !== null) {
          r4 = parse_hexDigit();
          if (r4 !== null) {
            r5 = parse_hexDigit();
            if (r5 !== null) {
              r6 = parse_hexDigit();
              if (r6 !== null) {
                r7 = parse_hexDigit();
                if (r7 !== null) {
                  r0 = [r3, r4, r5, r6, r7];
                } else {
                  r0 = null;
                  pos = r2;
                }
              } else {
                r0 = null;
                pos = r2;
              }
            } else {
              r0 = null;
              pos = r2;
            }
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, h1, h2, h3, h4) {
              return String.fromCharCode(parseInt(h1 + h2 + h3 + h4, 16));
            })(r1, r4, r5, r6, r7);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_eolEscapeSequence() {
        var r0, r1, r2, r3, r4;
        
        r1 = pos;
        r2 = pos;
        if (input.charCodeAt(pos) === 92) {
          r3 = "\\";
          pos++;
        } else {
          r3 = null;
          if (reportFailures === 0) {
            matchFailed("\"\\\\\"");
          }
        }
        if (r3 !== null) {
          r4 = parse_eol();
          if (r4 !== null) {
            r0 = [r3, r4];
          } else {
            r0 = null;
            pos = r2;
          }
        } else {
          r0 = null;
          pos = r2;
        }
        if (r0 !== null) {
          r0 = (function(offset, eol) { return eol; })(r1, r4);
        }
        if (r0 === null) {
          pos = r1;
        }
        return r0;
      }
      
      function parse_digit() {
        var r0;
        
        if (/^[0-9]/.test(input.charAt(pos))) {
          r0 = input.charAt(pos);
          pos++;
        } else {
          r0 = null;
          if (reportFailures === 0) {
            matchFailed("[0-9]");
          }
        }
        return r0;
      }
      
      function parse_hexDigit() {
        var r0;
        
        if (/^[0-9a-fA-F]/.test(input.charAt(pos))) {
          r0 = input.charAt(pos);
          pos++;
        } else {
          r0 = null;
          if (reportFailures === 0) {
            matchFailed("[0-9a-fA-F]");
          }
        }
        return r0;
      }
      
      function parse_letter() {
        var r0;
        
        r0 = parse_lowerCaseLetter();
        if (r0 === null) {
          r0 = parse_upperCaseLetter();
        }
        return r0;
      }
      
      function parse_lowerCaseLetter() {
        var r0;
        
        if (/^[a-z]/.test(input.charAt(pos))) {
          r0 = input.charAt(pos);
          pos++;
        } else {
          r0 = null;
          if (reportFailures === 0) {
            matchFailed("[a-z]");
          }
        }
        return r0;
      }
      
      function parse_upperCaseLetter() {
        var r0;
        
        if (/^[A-Z]/.test(input.charAt(pos))) {
          r0 = input.charAt(pos);
          pos++;
        } else {
          r0 = null;
          if (reportFailures === 0) {
            matchFailed("[A-Z]");
          }
        }
        return r0;
      }
      
      function parse___() {
        var r0, r1;
        
        r0 = [];
        r1 = parse_whitespace();
        if (r1 === null) {
          r1 = parse_eol();
          if (r1 === null) {
            r1 = parse_comment();
          }
        }
        while (r1 !== null) {
          r0.push(r1);
          r1 = parse_whitespace();
          if (r1 === null) {
            r1 = parse_eol();
            if (r1 === null) {
              r1 = parse_comment();
            }
          }
        }
        return r0;
      }
      
      function parse_comment() {
        var r0;
        
        reportFailures++;
        r0 = parse_singleLineComment();
        if (r0 === null) {
          r0 = parse_multiLineComment();
        }
        reportFailures--;
        if (reportFailures === 0 && r0 === null) {
          matchFailed("comment");
        }
        return r0;
      }
      
      function parse_singleLineComment() {
        var r0, r1, r2, r3, r4, r5, r6, r7;
        
        r1 = pos;
        if (input.substr(pos, 2) === "//") {
          r2 = "//";
          pos += 2;
        } else {
          r2 = null;
          if (reportFailures === 0) {
            matchFailed("\"//\"");
          }
        }
        if (r2 !== null) {
          r3 = [];
          r5 = pos;
          r7 = pos;
          reportFailures++;
          r6 = parse_eolChar();
          reportFailures--;
          if (r6 === null) {
            r6 = "";
          } else {
            r6 = null;
            pos = r7;
          }
          if (r6 !== null) {
            if (input.length > pos) {
              r7 = input.charAt(pos);
              pos++;
            } else {
              r7 = null;
              if (reportFailures === 0) {
                matchFailed("any character");
              }
            }
            if (r7 !== null) {
              r4 = [r6, r7];
            } else {
              r4 = null;
              pos = r5;
            }
          } else {
            r4 = null;
            pos = r5;
          }
          while (r4 !== null) {
            r3.push(r4);
            r5 = pos;
            r7 = pos;
            reportFailures++;
            r6 = parse_eolChar();
            reportFailures--;
            if (r6 === null) {
              r6 = "";
            } else {
              r6 = null;
              pos = r7;
            }
            if (r6 !== null) {
              if (input.length > pos) {
                r7 = input.charAt(pos);
                pos++;
              } else {
                r7 = null;
                if (reportFailures === 0) {
                  matchFailed("any character");
                }
              }
              if (r7 !== null) {
                r4 = [r6, r7];
              } else {
                r4 = null;
                pos = r5;
              }
            } else {
              r4 = null;
              pos = r5;
            }
          }
          if (r3 !== null) {
            r0 = [r2, r3];
          } else {
            r0 = null;
            pos = r1;
          }
        } else {
          r0 = null;
          pos = r1;
        }
        return r0;
      }
      
      function parse_multiLineComment() {
        var r0, r1, r2, r3, r4, r5, r6, r7;
        
        r1 = pos;
        if (input.substr(pos, 2) === "/*") {
          r2 = "/*";
          pos += 2;
        } else {
          r2 = null;
          if (reportFailures === 0) {
            matchFailed("\"/*\"");
          }
        }
        if (r2 !== null) {
          r3 = [];
          r5 = pos;
          r7 = pos;
          reportFailures++;
          if (input.substr(pos, 2) === "*/") {
            r6 = "*/";
            pos += 2;
          } else {
            r6 = null;
            if (reportFailures === 0) {
              matchFailed("\"*/\"");
            }
          }
          reportFailures--;
          if (r6 === null) {
            r6 = "";
          } else {
            r6 = null;
            pos = r7;
          }
          if (r6 !== null) {
            if (input.length > pos) {
              r7 = input.charAt(pos);
              pos++;
            } else {
              r7 = null;
              if (reportFailures === 0) {
                matchFailed("any character");
              }
            }
            if (r7 !== null) {
              r4 = [r6, r7];
            } else {
              r4 = null;
              pos = r5;
            }
          } else {
            r4 = null;
            pos = r5;
          }
          while (r4 !== null) {
            r3.push(r4);
            r5 = pos;
            r7 = pos;
            reportFailures++;
            if (input.substr(pos, 2) === "*/") {
              r6 = "*/";
              pos += 2;
            } else {
              r6 = null;
              if (reportFailures === 0) {
                matchFailed("\"*/\"");
              }
            }
            reportFailures--;
            if (r6 === null) {
              r6 = "";
            } else {
              r6 = null;
              pos = r7;
            }
            if (r6 !== null) {
              if (input.length > pos) {
                r7 = input.charAt(pos);
                pos++;
              } else {
                r7 = null;
                if (reportFailures === 0) {
                  matchFailed("any character");
                }
              }
              if (r7 !== null) {
                r4 = [r6, r7];
              } else {
                r4 = null;
                pos = r5;
              }
            } else {
              r4 = null;
              pos = r5;
            }
          }
          if (r3 !== null) {
            if (input.substr(pos, 2) === "*/") {
              r4 = "*/";
              pos += 2;
            } else {
              r4 = null;
              if (reportFailures === 0) {
                matchFailed("\"*/\"");
              }
            }
            if (r4 !== null) {
              r0 = [r2, r3, r4];
            } else {
              r0 = null;
              pos = r1;
            }
          } else {
            r0 = null;
            pos = r1;
          }
        } else {
          r0 = null;
          pos = r1;
        }
        return r0;
      }
      
      function parse_eol() {
        var r0;
        
        reportFailures++;
        if (input.charCodeAt(pos) === 10) {
          r0 = "\n";
          pos++;
        } else {
          r0 = null;
          if (reportFailures === 0) {
            matchFailed("\"\\n\"");
          }
        }
        if (r0 === null) {
          if (input.substr(pos, 2) === "\r\n") {
            r0 = "\r\n";
            pos += 2;
          } else {
            r0 = null;
            if (reportFailures === 0) {
              matchFailed("\"\\r\\n\"");
            }
          }
          if (r0 === null) {
            if (input.charCodeAt(pos) === 13) {
              r0 = "\r";
              pos++;
            } else {
              r0 = null;
              if (reportFailures === 0) {
                matchFailed("\"\\r\"");
              }
            }
            if (r0 === null) {
              if (input.charCodeAt(pos) === 8232) {
                r0 = "\u2028";
                pos++;
              } else {
                r0 = null;
                if (reportFailures === 0) {
                  matchFailed("\"\\u2028\"");
                }
              }
              if (r0 === null) {
                if (input.charCodeAt(pos) === 8233) {
                  r0 = "\u2029";
                  pos++;
                } else {
                  r0 = null;
                  if (reportFailures === 0) {
                    matchFailed("\"\\u2029\"");
                  }
                }
              }
            }
          }
        }
        reportFailures--;
        if (reportFailures === 0 && r0 === null) {
          matchFailed("end of line");
        }
        return r0;
      }
      
      function parse_eolChar() {
        var r0;
        
        if (/^[\n\r\u2028\u2029]/.test(input.charAt(pos))) {
          r0 = input.charAt(pos);
          pos++;
        } else {
          r0 = null;
          if (reportFailures === 0) {
            matchFailed("[\\n\\r\\u2028\\u2029]");
          }
        }
        return r0;
      }
      
      function parse_whitespace() {
        var r0;
        
        reportFailures++;
        if (/^[ \t\x0B\f\xA0\uFEFF\u1680\u180E\u2000-\u200A\u202F\u205F\u3000]/.test(input.charAt(pos))) {
          r0 = input.charAt(pos);
          pos++;
        } else {
          r0 = null;
          if (reportFailures === 0) {
            matchFailed("[ \\t\\x0B\\f\\xA0\\uFEFF\\u1680\\u180E\\u2000-\\u200A\\u202F\\u205F\\u3000]");
          }
        }
        reportFailures--;
        if (reportFailures === 0 && r0 === null) {
          matchFailed("whitespace");
        }
        return r0;
      }
      
      
      function cleanupExpected(expected) {
        expected.sort();
        
        var lastExpected = null;
        var cleanExpected = [];
        for (var i = 0; i < expected.length; i++) {
          if (expected[i] !== lastExpected) {
            cleanExpected.push(expected[i]);
            lastExpected = expected[i];
          }
        }
        return cleanExpected;
      }
      
      function computeErrorPosition() {
        /*
         * The first idea was to use |String.split| to break the input up to the
         * error position along newlines and derive the line and column from
         * there. However IE's |split| implementation is so broken that it was
         * enough to prevent it.
         */
        
        var line = 1;
        var column = 1;
        var seenCR = false;
        
        for (var i = 0; i < Math.max(pos, rightmostFailuresPos); i++) {
          var ch = input.charAt(i);
          if (ch === "\n") {
            if (!seenCR) { line++; }
            column = 1;
            seenCR = false;
          } else if (ch === "\r" || ch === "\u2028" || ch === "\u2029") {
            line++;
            column = 1;
            seenCR = true;
          } else {
            column++;
            seenCR = false;
          }
        }
        
        return { line: line, column: column };
      }
      
      
      var result = parseFunctions[startRule]();
      
      /*
       * The parser is now in one of the following three states:
       *
       * 1. The parser successfully parsed the whole input.
       *
       *    - |result !== null|
       *    - |pos === input.length|
       *    - |rightmostFailuresExpected| may or may not contain something
       *
       * 2. The parser successfully parsed only a part of the input.
       *
       *    - |result !== null|
       *    - |pos < input.length|
       *    - |rightmostFailuresExpected| may or may not contain something
       *
       * 3. The parser did not successfully parse any part of the input.
       *
       *   - |result === null|
       *   - |pos === 0|
       *   - |rightmostFailuresExpected| contains at least one failure
       *
       * All code following this comment (including called functions) must
       * handle these states.
       */
      if (result === null || pos !== input.length) {
        var offset = Math.max(pos, rightmostFailuresPos);
        var found = offset < input.length ? input.charAt(offset) : null;
        var errorPosition = computeErrorPosition();
        
        throw new this.SyntaxError(
          cleanupExpected(rightmostFailuresExpected),
          found,
          offset,
          errorPosition.line,
          errorPosition.column
        );
      }
      
      return result;
    },
    
    /* Returns the parser source code. */
    toSource: function() { return this._source; }
  };
  
  /* Thrown when a parser encounters a syntax error. */
  
  result.SyntaxError = function(expected, found, offset, line, column) {
    function buildMessage(expected, found) {
      var expectedHumanized, foundHumanized;
      
      switch (expected.length) {
        case 0:
          expectedHumanized = "end of input";
          break;
        case 1:
          expectedHumanized = expected[0];
          break;
        default:
          expectedHumanized = expected.slice(0, expected.length - 1).join(", ")
            + " or "
            + expected[expected.length - 1];
      }
      
      foundHumanized = found ? quote(found) : "end of input";
      
      return "Expected " + expectedHumanized + " but " + foundHumanized + " found.";
    }
    
    this.expected = expected;
    this.found = found;
    this.message = buildMessage(expected, found);
    this.offset = offset;
    this.line = line;
    this.column = column;
  };
  
  result.SyntaxError.prototype = (function(){
    var SyntaxError = result.SyntaxError;
    var F = function(){
      this.constructor = SyntaxError;
      this.name = "SyntaxError";
    };
    F.prototype = Error.prototype;
    return new F;
  })();
  
  return result;
})();
PEG.compiler = {
  /*
   * Names of passes that will get run during the compilation (in the specified
   * order).
   */
  appliedPassNames: [
    "reportMissingRules",
    "reportLeftRecursion",
    "removeProxyRules",
    "allocateRegisters",
    "generateCode"
  ],

  /*
   * Generates a parser from a specified grammar AST. Throws |PEG.GrammarError|
   * if the AST contains a semantic error. Note that not all errors are detected
   * during the generation and some may protrude to the generated parser and
   * cause its malfunction.
   */
  compile: function(ast, options) {
    var that = this;

    each(this.appliedPassNames, function(passName) {
      that.passes[passName](ast, options);
    });

    var source = ast.code;
    var result = eval(source);
    result._source = source;

    return result;
  }
};

/*
 * Compiler passes.
 *
 * Each pass is a function that is passed the AST. It can perform checks on it
 * or modify it as needed. If the pass encounters a semantic error, it throws
 * |PEG.GrammarError|.
 */
PEG.compiler.passes = {};

/* Checks that all referenced rules exist. */
PEG.compiler.passes.reportMissingRules = function(ast) {
  function nop() {}

  function checkExpression(node) { check(node.expression); }

  function checkSubnodes(propertyName) {
    return function(node) { each(node[propertyName], check); };
  }

  var check = buildNodeVisitor({
    grammar:      checkSubnodes("rules"),
    rule:         checkExpression,
    named:        checkExpression,
    choice:       checkSubnodes("alternatives"),
    action:       checkExpression,
    sequence:     checkSubnodes("elements"),
    labeled:      checkExpression,
    simple_and:   checkExpression,
    simple_not:   checkExpression,
    semantic_and: nop,
    semantic_not: nop,
    optional:     checkExpression,
    zero_or_more: checkExpression,
    one_or_more:  checkExpression,

    rule_ref:
      function(node) {
        if (!findRuleByName(ast, node.name)) {
          throw new PEG.GrammarError(
            "Referenced rule \"" + node.name + "\" does not exist."
          );
        }
      },

    literal:      nop,
    "class":      nop,
    any:          nop
  });

  check(ast);
};
/* Checks that no left recursion is present. */
PEG.compiler.passes.reportLeftRecursion = function(ast) {
  function nop() {}

  function checkExpression(node, appliedRules) {
    check(node.expression, appliedRules);
  }

  function checkSubnodes(propertyName) {
    return function(node, appliedRules) {
      each(node[propertyName], function(subnode) {
        check(subnode, appliedRules);
      });
    };
  }

  var check = buildNodeVisitor({
    grammar:     checkSubnodes("rules"),

    rule:
      function(node, appliedRules) {
        check(node.expression, appliedRules.concat(node.name));
      },

    named:       checkExpression,
    choice:      checkSubnodes("alternatives"),
    action:      checkExpression,

    sequence:
      function(node, appliedRules) {
        if (node.elements.length > 0) {
          check(node.elements[0], appliedRules);
        }
      },

    labeled:      checkExpression,
    simple_and:   checkExpression,
    simple_not:   checkExpression,
    semantic_and: nop,
    semantic_not: nop,
    optional:     checkExpression,
    zero_or_more: checkExpression,
    one_or_more:  checkExpression,

    rule_ref:
      function(node, appliedRules) {
        if (contains(appliedRules, node.name)) {
          throw new PEG.GrammarError(
            "Left recursion detected for rule \"" + node.name + "\"."
          );
        }
        check(findRuleByName(ast, node.name), appliedRules);
      },

    literal:      nop,
    "class":      nop,
    any:          nop
  });

  check(ast, []);
};
/*
 * Removes proxy rules -- that is, rules that only delegate to other rule.
 */
PEG.compiler.passes.removeProxyRules = function(ast) {
  function isProxyRule(node) {
    return node.type === "rule" && node.expression.type === "rule_ref";
  }

  function replaceRuleRefs(ast, from, to) {
    function nop() {}

    function replaceInExpression(node, from, to) {
      replace(node.expression, from, to);
    }

    function replaceInSubnodes(propertyName) {
      return function(node, from, to) {
        each(node[propertyName], function(subnode) {
          replace(subnode, from, to);
        });
      };
    }

    var replace = buildNodeVisitor({
      grammar:      replaceInSubnodes("rules"),
      rule:         replaceInExpression,
      named:        replaceInExpression,
      choice:       replaceInSubnodes("alternatives"),
      sequence:     replaceInSubnodes("elements"),
      labeled:      replaceInExpression,
      simple_and:   replaceInExpression,
      simple_not:   replaceInExpression,
      semantic_and: nop,
      semantic_not: nop,
      optional:     replaceInExpression,
      zero_or_more: replaceInExpression,
      one_or_more:  replaceInExpression,
      action:       replaceInExpression,

      rule_ref:
        function(node, from, to) {
          if (node.name === from) {
            node.name = to;
          }
        },

      literal:      nop,
      "class":      nop,
      any:          nop
    });

    replace(ast, from, to);
  }

  var indices = [];

  each(ast.rules, function(rule, i) {
    if (isProxyRule(rule)) {
      replaceRuleRefs(ast, rule.name, rule.expression.name);
      if (rule.name === ast.startRule) {
        ast.startRule = rule.expression.name;
      }
      indices.push(i);
    }
  });

  indices.reverse();

  each(indices, function(index) {
    ast.rules.splice(index, 1);
  });
};
/*
 * Allocates registers that the generated code for each node will use to store
 * match results and parse positions. For "action", "semantic_and" and
 * "semantic_or" nodes it also computes visibility of labels at the point of
 * action/predicate code execution and a mapping from label names to registers
 * that will contain the labeled values.
 *
 * The following will hold after running this pass:
 *
 *   * All nodes except "grammar" and "rule" nodes will have a |resultIndex|
 *     property. It will contain an index of a register that will store a match
 *     result of the expression represented by the node in generated code.
 *
 *   * Some nodes will have a |posIndex| property. It will contain an index of a
 *     register that will store a saved parse position in generated code.
 *
 *   * All "rule" nodes will contain a |registerCount| property. It will contain
 *     the number of registers that will be used by code generated for the
 *     rule's expression.
 *
 *   * All "action", "semantic_and" and "semantic_or" nodes will have a |params|
 *     property. It will contain a mapping from names of labels visible at the
 *     point of action/predicate code execution to registers that will contain
 *     the labeled values.
 */
PEG.compiler.passes.allocateRegisters = function(ast) {
  /*
   * Register allocator that allocates registers from an unlimited
   * integer-indexed pool. It allows allocating and releaseing registers in any
   * order. It also supports reference counting (this simplifies tracking active
   * registers when they store values passed to action/predicate code).
   * Allocating a register allways uses the first free register (the one with
   * the lowest index).
   */
  var registers = (function() {
    var refCounts = []; // reference count for each register that was
                        // allocated at least once

    return {
      alloc: function() {
        var i;

        for (i = 0; i < refCounts.length; i++) {
          if (refCounts[i] === 0) {
            refCounts[i] = 1;
            return i;
          }
        }

        refCounts.push(1);
        return refCounts.length - 1;
      },

      use: function(index) {
        refCounts[index]++;
      },

      release: function(index) {
        refCounts[index]--;
      },

      maxIndex: function() {
        return refCounts.length - 1;
      },

      reset: function() {
        refCounts = [];
      }
    };
  })();

  /*
   * Manages mapping of label names to indices of registers that will store the
   * labeled values as long as they are in scope.
   */
  var vars = (function(registers) {
    var envs = []; // stack of nested environments

    return {
      beginScope: function() {
        envs.push({});
      },

      endScope: function() {
        var env = envs.pop(), name;

        for (name in env) {
          registers.release(env[name]);
        }
      },

      add: function(name, index) {
        envs[envs.length - 1][name] = index;
        registers.use(index);
      },

      buildParams: function() {
        var env = envs[envs.length - 1], params = {}, name;

        for (name in env) {
          params[name] = env[name];
        }

        return params;
      }
    };
  })(registers);

  function savePos(node, f) {
    node.posIndex = registers.alloc();
    f();
    registers.release(node.posIndex);
  }

  function reuseResult(node, subnode) {
    subnode.resultIndex = node.resultIndex;
  }

  function allocResult(node, f) {
    node.resultIndex = registers.alloc();
    f();
    registers.release(node.resultIndex);
  }

  function scoped(f) {
    vars.beginScope();
    f();
    vars.endScope();
  }

  function nop() {}

  function computeExpressionScoped(node) {
    scoped(function() { compute(node.expression); });
  }

  function computeExpressionScopedReuseResult(node) {
    reuseResult(node, node.expression);
    computeExpressionScoped(node);
  }

  function computeExpressionScopedAllocResult(node) {
    allocResult(node.expression, function() { computeExpressionScoped(node); });
  }

  function computeExpressionScopedReuseResultSavePos(node) {
    savePos(node, function() { computeExpressionScopedReuseResult(node); });
  }

  function computeParams(node) {
    node.params = vars.buildParams();
  }

  var compute = buildNodeVisitor({
    grammar:
      function(node) {
        each(node.rules, compute);
      },

    rule:
      function(node) {
        registers.reset();
        computeExpressionScopedAllocResult(node);
        node.registerCount = registers.maxIndex() + 1;
      },

    named:
      function(node) {
        reuseResult(node, node.expression);
        compute(node.expression);
      },

    choice:
      function(node) {
        each(node.alternatives, function(alternative) {
          reuseResult(node, alternative);
          scoped(function() {
            compute(alternative);
          });
        });
      },

    action:
      function(node) {
        savePos(node, function() {
          reuseResult(node, node.expression);
          scoped(function() {
            compute(node.expression);
            computeParams(node);
          });
        });
      },

    sequence:
      function(node) {
        savePos(node, function() {
          each(node.elements, function(element) {
            element.resultIndex = registers.alloc();
            compute(element);
          });
          each(node.elements, function(element) {
            registers.release(element.resultIndex);
          });
        });
      },

    labeled:
      function(node) {
        vars.add(node.label, node.resultIndex);
        computeExpressionScopedReuseResult(node);
      },

    simple_and:   computeExpressionScopedReuseResultSavePos,
    simple_not:   computeExpressionScopedReuseResultSavePos,
    semantic_and: computeParams,
    semantic_not: computeParams,
    optional:     computeExpressionScopedReuseResult,
    zero_or_more: computeExpressionScopedAllocResult,
    one_or_more:  computeExpressionScopedAllocResult,
    rule_ref:     nop,
    literal:      nop,
    "class":      nop,
    any:          nop
  });

  compute(ast);
};
/* Generates the parser code. */
PEG.compiler.passes.generateCode = function(ast, options) {
  options = options || {};
  if (options.cache === undefined) {
    options.cache = false;
  }
  if (options.trackLineAndColumn === undefined) {
    options.trackLineAndColumn = false;
  }

  /*
   * Codie 1.1.0
   *
   * https://github.com/dmajda/codie
   *
   * Copyright (c) 2011-2012 David Majda
   * Licensend under the MIT license.
   */
  var Codie = (function(undefined) {

  function stringEscape(s) {
    function hex(ch) { return ch.charCodeAt(0).toString(16).toUpperCase(); }

    /*
     * ECMA-262, 5th ed., 7.8.4: All characters may appear literally in a
     * string literal except for the closing quote character, backslash,
     * carriage return, line separator, paragraph separator, and line feed.
     * Any character may appear in the form of an escape sequence.
     *
     * For portability, we also escape escape all control and non-ASCII
     * characters. Note that "\0" and "\v" escape sequences are not used
     * because JSHint does not like the first and IE the second.
     */
    return s
      .replace(/\\/g,   '\\\\') // backslash
      .replace(/"/g,    '\\"')  // closing double quote
      .replace(/\x08/g, '\\b')  // backspace
      .replace(/\t/g,   '\\t')  // horizontal tab
      .replace(/\n/g,   '\\n')  // line feed
      .replace(/\f/g,   '\\f')  // form feed
      .replace(/\r/g,   '\\r')  // carriage return
      .replace(/[\x00-\x07\x0B\x0E\x0F]/g, function(ch) { return '\\x0' + hex(ch); })
      .replace(/[\x10-\x1F\x80-\xFF]/g,    function(ch) { return '\\x'  + hex(ch); })
      .replace(/[\u0180-\u0FFF]/g,         function(ch) { return '\\u0' + hex(ch); })
      .replace(/[\u1080-\uFFFF]/g,         function(ch) { return '\\u'  + hex(ch); });
  }

  function push(s) { return '__p.push(' + s + ');'; }

  function pushRaw(template, length, state) {
    function unindent(code, level, unindentFirst) {
      return code.replace(
        new RegExp('^.{' + level +'}', "gm"),
        function(str, offset) {
          if (offset === 0) {
            return unindentFirst ? '' : str;
          } else {
            return "";
          }
        }
      );
    }

    var escaped = stringEscape(unindent(
          template.substring(0, length),
          state.indentLevel(),
          state.atBOL
        ));

    return escaped.length > 0 ? push('"' + escaped + '"') : '';
  }


  var Codie = {
    /* Codie version (uses semantic versioning). */
    VERSION: "1.1.0",

    /*
     * Specifies by how many characters do #if/#else and #for unindent their
     * content in the generated code.
     */
    indentStep: 2,

    /* Description of #-commands. Extend to define your own commands. */
    commands: {
      "if":   {
        params:  /^(.*)$/,
        compile: function(state, prefix, params) {
          return ['if(' + params[0] + '){', []];
        },
        stackOp: "push"
      },
      "else": {
        params:  /^$/,
        compile: function(state) {
          var stack = state.commandStack,
              insideElse = stack[stack.length - 1] === "else",
              insideIf   = stack[stack.length - 1] === "if";

          if (insideElse) { throw new Error("Multiple #elses."); }
          if (!insideIf)  { throw new Error("Using #else outside of #if."); }

          return ['}else{', []];
        },
        stackOp: "replace"
      },
      "for":  {
        params:  /^([a-zA-Z_][a-zA-Z0-9_]*)[ \t]+in[ \t]+(.*)$/,
        init:    function(state) {
          state.forCurrLevel = 0;  // current level of #for loop nesting
          state.forMaxLevel  = 0;  // maximum level of #for loop nesting
        },
        compile: function(state, prefix, params) {
          var c = '__c' + state.forCurrLevel, // __c for "collection"
              l = '__l' + state.forCurrLevel, // __l for "length"
              i = '__i' + state.forCurrLevel; // __i for "index"

          state.forCurrLevel++;
          if (state.forMaxLevel < state.forCurrLevel) {
            state.forMaxLevel = state.forCurrLevel;
          }

          return [
            c + '=' + params[1] + ';'
              + l + '=' + c + '.length;'
              + 'for(' + i + '=0;' + i + '<' + l + ';' + i + '++){'
              + params[0] + '=' + c + '[' + i + '];',
            [params[0], c, l, i]
          ];
        },
        exit:    function(state) { state.forCurrLevel--; },
        stackOp: "push"
      },
      "end":  {
        params:  /^$/,
        compile: function(state) {
          var stack = state.commandStack, exit;

          if (stack.length === 0) { throw new Error("Too many #ends."); }

          exit = Codie.commands[stack[stack.length - 1]].exit;
          if (exit) { exit(state); }

          return ['}', []];
        },
        stackOp: "pop"
      },
      "block": {
        params: /^(.*)$/,
        compile: function(state, prefix, params) {
          var x = '__x', // __x for "prefix",
              n = '__n', // __n for "lines"
              l = '__l', // __l for "length"
              i = '__i'; // __i for "index"

          /*
           * Originally, the generated code used |String.prototype.replace|, but
           * it is buggy in certain versions of V8 so it was rewritten. See the
           * tests for details.
           */
          return [
            x + '="' + stringEscape(prefix.substring(state.indentLevel())) + '";'
              + n + '=(' + params[0] + ').toString().split("\\n");'
              + l + '=' + n + '.length;'
              + 'for(' + i + '=0;' + i + '<' + l + ';' + i + '++){'
              + n + '[' + i +']=' + x + '+' + n + '[' + i + ']+"\\n";'
              + '}'
              + push(n + '.join("")'),
            [x, n, l, i]
          ];
        },
        stackOp: "nop"
      }
    },

    /*
     * Compiles a template into a function. When called, this function will
     * execute the template in the context of an object passed in a parameter and
     * return the result.
     */
    template: function(template) {
      var stackOps = {
        push:    function(stack, name) { stack.push(name); },
        replace: function(stack, name) { stack[stack.length - 1] = name; },
        pop:     function(stack)       { stack.pop(); },
        nop:     function()            { }
      };

      function compileExpr(state, expr) {
        state.atBOL = false;
        return [push(expr), []];
      }

      function compileCommand(state, prefix, name, params) {
        var command, match, result;

        command = Codie.commands[name];
        if (!command) { throw new Error("Unknown command: #" + name + "."); }

        match = command.params.exec(params);
        if (match === null) {
          throw new Error(
            "Invalid params for command #" + name + ": " + params + "."
          );
        }

        result = command.compile(state, prefix, match.slice(1));
        stackOps[command.stackOp](state.commandStack, name);
        state.atBOL = true;
        return result;
      }

      var state = {               // compilation state
            commandStack: [],     //   stack of commands as they were nested
            atBOL:        true,   //   is the next character to process at BOL?
            indentLevel:  function() {
              return Codie.indentStep * this.commandStack.length;
            }
          },
          code = '',              // generated template function code
          vars = ['__p=[]'],      // variables used by generated code
          name, match, result, i;

      /* Initialize state. */
      for (name in Codie.commands) {
        if (Codie.commands[name].init) { Codie.commands[name].init(state); }
      }

      /* Compile the template. */
      while ((match = /^([ \t]*)#([a-zA-Z_][a-zA-Z0-9_]*)(?:[ \t]+([^ \t\n][^\n]*))?[ \t]*(?:\n|$)|#\{([^}]*)\}/m.exec(template)) !== null) {
        code += pushRaw(template, match.index, state);
        result = match[2] !== undefined && match[2] !== ""
          ? compileCommand(state, match[1], match[2], match[3] || "") // #-command
          : compileExpr(state, match[4]);                             // #{...}
        code += result[0];
        vars = vars.concat(result[1]);
        template = template.substring(match.index + match[0].length);
      }
      code += pushRaw(template, template.length, state);

      /* Check the final state. */
      if (state.commandStack.length > 0) { throw new Error("Missing #end."); }

      /* Sanitize the list of variables used by commands. */
      vars.sort();
      for (i = 0; i < vars.length; i++) {
        if (vars[i] === vars[i - 1]) { vars.splice(i--, 1); }
      }

      /* Create the resulting function. */
      return new Function("__v", [
        '__v=__v||{};',
        'var ' + vars.join(',') + ';',
        'with(__v){',
        code,
        'return __p.join("").replace(/^\\n+|\\n+$/g,"");};'
      ].join(''));
    }
  };

  return Codie;

  })();

  var templates = (function() {
    var name,
        templates = {},
        sources = {
          grammar: [
            '(function(){',
            '  /*',
            '   * Generated by PEG.js 0.7.0.',
            '   *',
            '   * http://pegjs.majda.cz/',
            '   */',
            '  ',
            /* This needs to be in sync with |quote| in utils.js. */
            '  function quote(s) {',
            '    /*',
            '     * ECMA-262, 5th ed., 7.8.4: All characters may appear literally in a',
            '     * string literal except for the closing quote character, backslash,',
            '     * carriage return, line separator, paragraph separator, and line feed.',
            '     * Any character may appear in the form of an escape sequence.',
            '     *',
            '     * For portability, we also escape escape all control and non-ASCII',
            '     * characters. Note that "\\0" and "\\v" escape sequences are not used',
            '     * because JSHint does not like the first and IE the second.',
            '     */',
            '     return \'"\' + s',
            '      .replace(/\\\\/g, \'\\\\\\\\\')  // backslash',
            '      .replace(/"/g, \'\\\\"\')    // closing quote character',
            '      .replace(/\\x08/g, \'\\\\b\') // backspace',
            '      .replace(/\\t/g, \'\\\\t\')   // horizontal tab',
            '      .replace(/\\n/g, \'\\\\n\')   // line feed',
            '      .replace(/\\f/g, \'\\\\f\')   // form feed',
            '      .replace(/\\r/g, \'\\\\r\')   // carriage return',
            '      .replace(/[\\x00-\\x07\\x0B\\x0E-\\x1F\\x80-\\uFFFF]/g, escape)',
            '      + \'"\';',
            '  }',
            '  ',
            '  var result = {',
            '    /*',
            '     * Parses the input with a generated parser. If the parsing is successfull,',
            '     * returns a value explicitly or implicitly specified by the grammar from',
            '     * which the parser was generated (see |PEG.buildParser|). If the parsing is',
            '     * unsuccessful, throws |PEG.parser.SyntaxError| describing the error.',
            '     */',
            '    parse: function(input, startRule) {',
            '      var parseFunctions = {',
            '        #for rule in node.rules',
            '          #{string(rule.name) + ": parse_" + rule.name + (rule !== node.rules[node.rules.length - 1] ? "," : "")}',
            '        #end',
            '      };',
            '      ',
            '      if (startRule !== undefined) {',
            '        if (parseFunctions[startRule] === undefined) {',
            '          throw new Error("Invalid rule name: " + quote(startRule) + ".");',
            '        }',
            '      } else {',
            '        startRule = #{string(node.startRule)};',
            '      }',
            '      ',
            '      #{posInit("pos")};',
            '      var reportFailures = 0;', // 0 = report, anything > 0 = do not report
            '      #{posInit("rightmostFailuresPos")};',
            '      var rightmostFailuresExpected = [];',
            '      #if options.cache',
            '        var cache = {};',
            '      #end',
            '      ',
            /* This needs to be in sync with |padLeft| in utils.js. */
            '      function padLeft(input, padding, length) {',
            '        var result = input;',
            '        ',
            '        var padLength = length - input.length;',
            '        for (var i = 0; i < padLength; i++) {',
            '          result = padding + result;',
            '        }',
            '        ',
            '        return result;',
            '      }',
            '      ',
            /* This needs to be in sync with |escape| in utils.js. */
            '      function escape(ch) {',
            '        var charCode = ch.charCodeAt(0);',
            '        var escapeChar;',
            '        var length;',
            '        ',
            '        if (charCode <= 0xFF) {',
            '          escapeChar = \'x\';',
            '          length = 2;',
            '        } else {',
            '          escapeChar = \'u\';',
            '          length = 4;',
            '        }',
            '        ',
            '        return \'\\\\\' + escapeChar + padLeft(charCode.toString(16).toUpperCase(), \'0\', length);',
            '      }',
            '      ',
            '      #if options.trackLineAndColumn',
            '        function clone(object) {',
            '          var result = {};',
            '          for (var key in object) {',
            '            result[key] = object[key];',
            '          }',
            '          return result;',
            '        }',
            '        ',
            '        function advance(pos, n) {',
            '          var endOffset = pos.offset + n;',
            '          ',
            '          for (var offset = pos.offset; offset < endOffset; offset++) {',
            '            var ch = input.charAt(offset);',
            '            if (ch === "\\n") {',
            '              if (!pos.seenCR) { pos.line++; }',
            '              pos.column = 1;',
            '              pos.seenCR = false;',
            '            } else if (ch === "\\r" || ch === "\\u2028" || ch === "\\u2029") {',
            '              pos.line++;',
            '              pos.column = 1;',
            '              pos.seenCR = true;',
            '            } else {',
            '              pos.column++;',
            '              pos.seenCR = false;',
            '            }',
            '          }',
            '          ',
            '          pos.offset += n;',
            '        }',
            '        ',
            '      #end',
            '      function matchFailed(failure) {',
            '        if (#{posOffset("pos")} < #{posOffset("rightmostFailuresPos")}) {',
            '          return;',
            '        }',
            '        ',
            '        if (#{posOffset("pos")} > #{posOffset("rightmostFailuresPos")}) {',
            '          rightmostFailuresPos = #{posClone("pos")};',
            '          rightmostFailuresExpected = [];',
            '        }',
            '        ',
            '        rightmostFailuresExpected.push(failure);',
            '      }',
            '      ',
            '      #for rule in node.rules',
            '        #block emit(rule)',
            '        ',
            '      #end',
            '      ',
            '      function cleanupExpected(expected) {',
            '        expected.sort();',
            '        ',
            '        var lastExpected = null;',
            '        var cleanExpected = [];',
            '        for (var i = 0; i < expected.length; i++) {',
            '          if (expected[i] !== lastExpected) {',
            '            cleanExpected.push(expected[i]);',
            '            lastExpected = expected[i];',
            '          }',
            '        }',
            '        return cleanExpected;',
            '      }',
            '      ',
            '      #if !options.trackLineAndColumn',
            '        function computeErrorPosition() {',
            '          /*',
            '           * The first idea was to use |String.split| to break the input up to the',
            '           * error position along newlines and derive the line and column from',
            '           * there. However IE\'s |split| implementation is so broken that it was',
            '           * enough to prevent it.',
            '           */',
            '          ',
            '          var line = 1;',
            '          var column = 1;',
            '          var seenCR = false;',
            '          ',
            '          for (var i = 0; i < Math.max(pos, rightmostFailuresPos); i++) {',
            '            var ch = input.charAt(i);',
            '            if (ch === "\\n") {',
            '              if (!seenCR) { line++; }',
            '              column = 1;',
            '              seenCR = false;',
            '            } else if (ch === "\\r" || ch === "\\u2028" || ch === "\\u2029") {',
            '              line++;',
            '              column = 1;',
            '              seenCR = true;',
            '            } else {',
            '              column++;',
            '              seenCR = false;',
            '            }',
            '          }',
            '          ',
            '          return { line: line, column: column };',
            '        }',
            '      #end',
            '      ',
            '      #if node.initializer',
            '        #block emit(node.initializer)',
            '      #end',
            '      ',
            '      var result = parseFunctions[startRule]();',
            '      ',
            '      /*',
            '       * The parser is now in one of the following three states:',
            '       *',
            '       * 1. The parser successfully parsed the whole input.',
            '       *',
            '       *    - |result !== null|',
            '       *    - |#{posOffset("pos")} === input.length|',
            '       *    - |rightmostFailuresExpected| may or may not contain something',
            '       *',
            '       * 2. The parser successfully parsed only a part of the input.',
            '       *',
            '       *    - |result !== null|',
            '       *    - |#{posOffset("pos")} < input.length|',
            '       *    - |rightmostFailuresExpected| may or may not contain something',
            '       *',
            '       * 3. The parser did not successfully parse any part of the input.',
            '       *',
            '       *   - |result === null|',
            '       *   - |#{posOffset("pos")} === 0|',
            '       *   - |rightmostFailuresExpected| contains at least one failure',
            '       *',
            '       * All code following this comment (including called functions) must',
            '       * handle these states.',
            '       */',
            '      if (result === null || #{posOffset("pos")} !== input.length) {',
            '        var offset = Math.max(#{posOffset("pos")}, #{posOffset("rightmostFailuresPos")});',
            '        var found = offset < input.length ? input.charAt(offset) : null;',
            '        #if options.trackLineAndColumn',
            '          var errorPosition = #{posOffset("pos")} > #{posOffset("rightmostFailuresPos")} ? pos : rightmostFailuresPos;',
            '        #else',
            '          var errorPosition = computeErrorPosition();',
            '        #end',
            '        ',
            '        throw new this.SyntaxError(',
            '          cleanupExpected(rightmostFailuresExpected),',
            '          found,',
            '          offset,',
            '          errorPosition.line,',
            '          errorPosition.column',
            '        );',
            '      }',
            '      ',
            '      return result;',
            '    },',
            '    ',
            '    /* Returns the parser source code. */',
            '    toSource: function() { return this._source; }',
            '  };',
            '  ',
            '  /* Thrown when a parser encounters a syntax error. */',
            '  ',
            '  result.SyntaxError = function(expected, found, offset, line, column) {',
            '    function buildMessage(expected, found) {',
            '      var expectedHumanized, foundHumanized;',
            '      ',
            '      switch (expected.length) {',
            '        case 0:',
            '          expectedHumanized = "end of input";',
            '          break;',
            '        case 1:',
            '          expectedHumanized = expected[0];',
            '          break;',
            '        default:',
            '          expectedHumanized = expected.slice(0, expected.length - 1).join(", ")',
            '            + " or "',
            '            + expected[expected.length - 1];',
            '      }',
            '      ',
            '      foundHumanized = found ? quote(found) : "end of input";',
            '      ',
            '      return "Expected " + expectedHumanized + " but " + foundHumanized + " found.";',
            '    }',
            '    ',
            '    this.expected = expected;',
            '    this.found = found;',
            '    this.message = buildMessage(expected, found);',
            '    this.offset = offset;',
            '    this.line = line;',
            '    this.column = column;',
            '  };',
            '  ',
            '  result.SyntaxError.prototype = (function(){',
            '    var SyntaxError = result.SyntaxError;',
            '    var F = function(){',
            '      this.constructor = SyntaxError;',
            '      this.name = "SyntaxError";',
            '    };',
            '    F.prototype = Error.prototype;',
            '    return new F;',
            '  })();',
            '  ',
            '  return result;',
            '})()'
          ],
          rule: [
            'function parse_#{node.name}() {',
            '  #if options.cache',
            '    var cacheKey = "#{node.name}@" + #{posOffset("pos")};',
            '    var cachedResult = cache[cacheKey];',
            '    if (cachedResult) {',
            '      pos = #{posClone("cachedResult.nextPos")};',
            '      return cachedResult.result;',
            '    }',
            '    ',
            '  #end',
            '  #if node.registerCount > 0',
            '    var #{map(range(node.registerCount), r).join(", ")};',
            '  #end',
            '  ',
            '  #block emit(node.expression)',
            '  #if options.cache',
            '    ',
            '    cache[cacheKey] = {',
            '      nextPos: #{posClone("pos")},',
            '      result:  #{r(node.expression.resultIndex)}',
            '    };',
            '  #end',
            '  return #{r(node.expression.resultIndex)};',
            '}'
          ],
          named: [
            'reportFailures++;',
            '#block emit(node.expression)',
            'reportFailures--;',
            'if (reportFailures === 0 && #{r(node.resultIndex)} === null) {',
            '  matchFailed(#{string(node.name)});',
            '}'
          ],
          choice: [
            '#block emit(alternative)',
            '#block nextAlternativesCode'
          ],
          "choice.next": [
            'if (#{r(node.resultIndex)} === null) {',
            '  #block code',
            '}'
          ],
          action: [
            '#{posSave(node)};',
            '#block emit(node.expression)',
            'if (#{r(node.resultIndex)} !== null) {',
            '  #{r(node.resultIndex)} = (function(#{(options.trackLineAndColumn ? ["offset", "line", "column"] : ["offset"]).concat(keys(node.params)).join(", ")}) {#{node.code}})(#{(options.trackLineAndColumn ? [r(node.posIndex) + ".offset", r(node.posIndex) + ".line", r(node.posIndex) + ".column"] : [r(node.posIndex)]).concat(map(values(node.params), r)).join(", ")});',
            '}',
            'if (#{r(node.resultIndex)} === null) {',
            '  #{posRestore(node)};',
            '}'
          ],
          sequence: [
            '#{posSave(node)};',
            '#block code'
          ],
          "sequence.iteration": [
            '#block emit(element)',
            'if (#{r(element.resultIndex)} !== null) {',
            '  #block code',
            '} else {',
            '  #{r(node.resultIndex)} = null;',
            '  #{posRestore(node)};',
            '}'
          ],
          "sequence.inner": [
            '#{r(node.resultIndex)} = [#{map(pluck(node.elements, "resultIndex"), r).join(", ")}];'
          ],
          simple_and: [
            '#{posSave(node)};',
            'reportFailures++;',
            '#block emit(node.expression)',
            'reportFailures--;',
            'if (#{r(node.resultIndex)} !== null) {',
            '  #{r(node.resultIndex)} = "";',
            '  #{posRestore(node)};',
            '} else {',
            '  #{r(node.resultIndex)} = null;',
            '}'
          ],
          simple_not: [
            '#{posSave(node)};',
            'reportFailures++;',
            '#block emit(node.expression)',
            'reportFailures--;',
            'if (#{r(node.resultIndex)} === null) {',
            '  #{r(node.resultIndex)} = "";',
            '} else {',
            '  #{r(node.resultIndex)} = null;',
            '  #{posRestore(node)};',
            '}'
          ],
          semantic_and: [
            '#{r(node.resultIndex)} = (function(#{(options.trackLineAndColumn ? ["offset", "line", "column"] : ["offset"]).concat(keys(node.params)).join(", ")}) {#{node.code}})(#{(options.trackLineAndColumn ? ["pos.offset", "pos.line", "pos.column"] : ["pos"]).concat(map(values(node.params), r)).join(", ")}) ? "" : null;'
          ],
          semantic_not: [
            '#{r(node.resultIndex)} = (function(#{(options.trackLineAndColumn ? ["offset", "line", "column"] : ["offset"]).concat(keys(node.params)).join(", ")}) {#{node.code}})(#{(options.trackLineAndColumn ? ["pos.offset", "pos.line", "pos.column"] : ["pos"]).concat(map(values(node.params), r)).join(", ")}) ? null : "";'
          ],
          optional: [
            '#block emit(node.expression)',
            '#{r(node.resultIndex)} = #{r(node.resultIndex)} !== null ? #{r(node.resultIndex)} : "";'
          ],
          zero_or_more: [
            '#{r(node.resultIndex)} = [];',
            '#block emit(node.expression)',
            'while (#{r(node.expression.resultIndex)} !== null) {',
            '  #{r(node.resultIndex)}.push(#{r(node.expression.resultIndex)});',
            '  #block emit(node.expression)',
            '}'
          ],
          one_or_more: [
            '#block emit(node.expression)',
            'if (#{r(node.expression.resultIndex)} !== null) {',
            '  #{r(node.resultIndex)} = [];',
            '  while (#{r(node.expression.resultIndex)} !== null) {',
            '    #{r(node.resultIndex)}.push(#{r(node.expression.resultIndex)});',
            '    #block emit(node.expression)',
            '  }',
            '} else {',
            '  #{r(node.resultIndex)} = null;',
            '}'
          ],
          rule_ref: [
            '#{r(node.resultIndex)} = parse_#{node.name}();'
          ],
          literal: [
            '#if node.value.length === 0',
            '  #{r(node.resultIndex)} = "";',
            '#else',
            '  #if !node.ignoreCase',
            '    #if node.value.length === 1',
            '      if (input.charCodeAt(#{posOffset("pos")}) === #{node.value.charCodeAt(0)}) {',
            '    #else',
            '      if (input.substr(#{posOffset("pos")}, #{node.value.length}) === #{string(node.value)}) {',
            '    #end',
            '  #else',
            /*
             * One-char literals are not optimized when case-insensitive
             * matching is enabled. This is because there is no simple way to
             * lowercase a character code that works for character outside ASCII
             * letters. Moreover, |toLowerCase| can change string length,
             * meaning the result of lowercasing a character can be more
             * characters.
             */
            '    if (input.substr(#{posOffset("pos")}, #{node.value.length}).toLowerCase() === #{string(node.value.toLowerCase())}) {',
            '  #end',
            '    #if !node.ignoreCase',
            '      #{r(node.resultIndex)} = #{string(node.value)};',
            '    #else',
            '      #{r(node.resultIndex)} = input.substr(#{posOffset("pos")}, #{node.value.length});',
            '    #end',
            '    #{posAdvance(node.value.length)};',
            '  } else {',
            '    #{r(node.resultIndex)} = null;',
            '    if (reportFailures === 0) {',
            '      matchFailed(#{string(string(node.value))});',
            '    }',
            '  }',
            '#end'
          ],
          "class": [
            'if (#{regexp}.test(input.charAt(#{posOffset("pos")}))) {',
            '  #{r(node.resultIndex)} = input.charAt(#{posOffset("pos")});',
            '  #{posAdvance(1)};',
            '} else {',
            '  #{r(node.resultIndex)} = null;',
            '  if (reportFailures === 0) {',
            '    matchFailed(#{string(node.rawText)});',
            '  }',
            '}'
          ],
          any: [
            'if (input.length > #{posOffset("pos")}) {',
            '  #{r(node.resultIndex)} = input.charAt(#{posOffset("pos")});',
            '  #{posAdvance(1)};',
            '} else {',
            '  #{r(node.resultIndex)} = null;',
            '  if (reportFailures === 0) {',
            '    matchFailed("any character");',
            '  }',
            '}'
          ]
        };

    for (name in sources) {
      templates[name] = Codie.template(sources[name].join('\n'));
    }

    return templates;
  })();

  function fill(name, vars) {
    vars.string  = quote;
    vars.range   = range;
    vars.map     = map;
    vars.pluck   = pluck;
    vars.keys    = keys;
    vars.values  = values;
    vars.emit    = emit;
    vars.options = options;

    vars.r = function(index) { return "r" + index; };

    /* Position-handling macros */
    if (options.trackLineAndColumn) {
      vars.posInit    = function(name) {
        return "var "
             + name
             + " = "
             + "{ offset: 0, line: 1, column: 1, seenCR: false }";
      };
      vars.posClone   = function(name) { return "clone(" + name + ")"; };
      vars.posOffset  = function(name) { return name + ".offset"; };

      vars.posAdvance = function(n)    { return "advance(pos, " + n + ")"; };
    } else {
      vars.posInit    = function(name) { return "var " + name + " = 0"; };
      vars.posClone   = function(name) { return name; };
      vars.posOffset  = function(name) { return name; };

      vars.posAdvance = function(n) {
        return n === 1 ? "pos++" : "pos += " + n;
      };
    }
    vars.posSave    = function(node) {
      return vars.r(node.posIndex) + " = " + vars.posClone("pos");
    };
    vars.posRestore = function(node) {
      return "pos" + " = " + vars.posClone(vars.r(node.posIndex));
    };

    return templates[name](vars);
  }

  function emitSimple(name) {
    return function(node) { return fill(name, { node: node }); };
  }

  var emit = buildNodeVisitor({
    grammar: emitSimple("grammar"),

    initializer: function(node) { return node.code; },

    rule: emitSimple("rule"),

    /*
     * The contract for all code fragments generated by the following functions
     * is as follows.
     *
     * The code fragment tries to match a part of the input starting with the
     * position indicated in |pos|. That position may point past the end of the
     * input.
     *
     * * If the code fragment matches the input, it advances |pos| to point to
     *   the first chracter following the matched part of the input and sets a
     *   register with index specified by |node.resultIndex| to an appropriate
     *   value. This value is always non-|null|.
     *
     * * If the code fragment does not match the input, it returns with |pos|
     *   set to the original value and it sets a register with index specified
     *   by |node.posIndex| to |null|.
     *
     * The code uses only registers with indices specified by |node.resultIndex|
     * and |node.posIndex| where |node| is the processed node or some of its
     * subnodes. It does not use any other registers.
     */

    named: emitSimple("named"),

    choice: function(node) {
      var code, nextAlternativesCode;

      for (var i = node.alternatives.length - 1; i >= 0; i--) {
        nextAlternativesCode = i !== node.alternatives.length - 1
          ? fill("choice.next", { node: node, code: code })
          : '';
        code = fill("choice", {
          alternative:          node.alternatives[i],
          nextAlternativesCode: nextAlternativesCode
        });
      }

      return code;
    },

    action: emitSimple("action"),

    sequence: function(node) {
      var code = fill("sequence.inner", { node: node });

      for (var i = node.elements.length - 1; i >= 0; i--) {
        code = fill("sequence.iteration", {
          node:    node,
          element: node.elements[i],
          code:    code
        });
      }

      return fill("sequence", { node: node, code: code });
    },

    labeled: function(node) { return emit(node.expression); },

    simple_and:   emitSimple("simple_and"),
    simple_not:   emitSimple("simple_not"),
    semantic_and: emitSimple("semantic_and"),
    semantic_not: emitSimple("semantic_not"),
    optional:     emitSimple("optional"),
    zero_or_more: emitSimple("zero_or_more"),
    one_or_more:  emitSimple("one_or_more"),
    rule_ref:     emitSimple("rule_ref"),
    literal:      emitSimple("literal"),

    "class": function(node) {
      var regexp;

      if (node.parts.length > 0) {
        regexp = '/^['
          + (node.inverted ? '^' : '')
          + map(node.parts, function(part) {
              return part instanceof Array
                ? quoteForRegexpClass(part[0])
                  + '-'
                  + quoteForRegexpClass(part[1])
                : quoteForRegexpClass(part);
            }).join('')
          + ']/' + (node.ignoreCase ? 'i' : '');
      } else {
        /*
         * Stupid IE considers regexps /[]/ and /[^]/ syntactically invalid, so
         * we translate them into euqivalents it can handle.
         */
        regexp = node.inverted ? '/^[\\S\\s]/' : '/^(?!)/';
      }

      return fill("class", { node: node, regexp: regexp });
    },

    any: emitSimple("any")
  });

  ast.code = emit(ast);
};

return PEG;

})();

if (typeof module !== "undefined") {
  module.exports = PEG;
}
