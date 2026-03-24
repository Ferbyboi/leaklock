# Skill: Code Review

## Purpose
Run a structured code review on changed files using a sub-agent.

## Checklist
- [ ] Check for security issues (injection, XSS, exposed secrets)
- [ ] Check for over-engineering or unnecessary complexity
- [ ] Verify TypeScript types are correct and not `any`
- [ ] Confirm no unused variables or imports
- [ ] Ensure no console.log or debug statements left in
- [ ] Check error handling at system boundaries (user input, external APIs)
- [ ] Confirm no hardcoded credentials or env values

## Usage
Invoke with: "Run a code review on [file or diff]"
Sub-agent model: Haiku or Sonnet
