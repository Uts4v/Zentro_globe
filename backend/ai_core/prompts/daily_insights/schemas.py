from pydantic import BaseModel, Field
from typing import Literal


class InsightEvidence(BaseModel):
    metric: str
    value: str
    comparison: str | None = None


class MerchantRecommendation(BaseModel):
    title: str = Field(max_length=100)
    explanation: str = Field(max_length=500)
    priority: Literal["low", "medium", "high"]
    suggested_action: str = Field(max_length=300)
    evidence: list[InsightEvidence]


class DailyMerchantInsightSchema(BaseModel):
    report_date: str
    executive_summary: str = Field(max_length=500)
    positive_signals: list[str]
    concerns: list[str]
    recommendations: list[MerchantRecommendation] = Field(max_length=5)
    metrics_referenced: list[str]
    confidence: float = Field(ge=0, le=1)
