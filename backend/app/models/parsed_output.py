from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


class LineItem(BaseModel):
    description: str
    quantity: float = Field(ge=0)
    unit: str = ""
    unit_price_cents: int = Field(ge=0, default=0)
    total_cents: int = Field(ge=0, default=0)


class ParsedFieldNote(BaseModel):
    job_id: Optional[str] = None
    technician_name: Optional[str] = None
    items_found: list[LineItem] = []
    materials_used: list[LineItem] = []
    additional_work: list[str] = []
    issues_noted: list[str] = []
    confidence_score: float = Field(ge=0, le=1, default=0.8)
    raw_text: str = ""


class ComplianceViolation(BaseModel):
    rule_id: str
    description: str
    severity: str  # "critical" | "warning" | "info"
    evidence: str


class ComplianceResult(BaseModel):
    job_id: str
    niche_type: str
    passed: bool
    score: float = Field(ge=0, le=100)
    violations: list[ComplianceViolation] = []
    recommendations: list[str] = []
    requires_immediate_action: bool = False
