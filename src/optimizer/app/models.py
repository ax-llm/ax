from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, Field


class ParameterType(str, Enum):
    """Parameter type for optimization."""
    FLOAT = "float"
    INT = "int"
    CATEGORICAL = "categorical"


class OptimizationDirection(str, Enum):
    """Direction for optimization."""
    MINIMIZE = "minimize"
    MAXIMIZE = "maximize"


class JobStatus(str, Enum):
    """Status of optimization job."""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class Parameter(BaseModel):
    """Parameter definition for optimization."""
    name: str = Field(..., description="Parameter name")
    type: ParameterType = Field(..., description="Parameter type")
    low: Optional[Union[float, int]] = Field(None, description="Lower bound for numeric parameters")
    high: Optional[Union[float, int]] = Field(None, description="Upper bound for numeric parameters")
    choices: Optional[List[Union[str, int, float]]] = Field(None, description="Choices for categorical parameters")
    step: Optional[Union[float, int]] = Field(None, description="Step size for numeric parameters")
    log: bool = Field(False, description="Use log scale for numeric parameters")


class ObjectiveFunction(BaseModel):
    """Objective function configuration."""
    name: str = Field(..., description="Function name")
    direction: OptimizationDirection = Field(OptimizationDirection.MINIMIZE, description="Optimization direction")


class OptimizationRequest(BaseModel):
    """Request to start optimization."""
    study_name: Optional[str] = Field(None, description="Study name (auto-generated if not provided)")
    parameters: List[Parameter] = Field(..., description="Parameters to optimize")
    objective: ObjectiveFunction = Field(..., description="Objective function configuration")
    n_trials: int = Field(100, description="Number of trials to run", ge=1, le=10000)
    timeout: Optional[int] = Field(None, description="Timeout in seconds")
    sampler: str = Field("TPESampler", description="Optuna sampler to use")
    pruner: Optional[str] = Field("MedianPruner", description="Optuna pruner to use")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")


class Trial(BaseModel):
    """Single trial result."""
    number: int = Field(..., description="Trial number")
    value: Optional[float] = Field(None, description="Objective value")
    params: Dict[str, Union[str, int, float]] = Field(..., description="Parameter values")
    state: str = Field(..., description="Trial state")
    datetime_start: Optional[datetime] = Field(None, description="Start time")
    datetime_complete: Optional[datetime] = Field(None, description="Completion time")
    duration: Optional[float] = Field(None, description="Duration in seconds")


class OptimizationResult(BaseModel):
    """Optimization results."""
    study_name: str = Field(..., description="Study name")
    best_trial: Optional[Trial] = Field(None, description="Best trial")
    best_value: Optional[float] = Field(None, description="Best objective value")
    best_params: Optional[Dict[str, Union[str, int, float]]] = Field(None, description="Best parameters")
    trials: List[Trial] = Field(..., description="All trials")
    n_trials: int = Field(..., description="Number of completed trials")
    direction: OptimizationDirection = Field(..., description="Optimization direction")


class JobResponse(BaseModel):
    """Response for job creation."""
    job_id: str = Field(..., description="Unique job identifier")
    study_name: str = Field(..., description="Study name")
    status: JobStatus = Field(..., description="Job status")
    created_at: datetime = Field(..., description="Creation timestamp")


class JobStatusResponse(BaseModel):
    """Job status information."""
    job_id: str = Field(..., description="Job identifier")
    study_name: str = Field(..., description="Study name")
    status: JobStatus = Field(..., description="Current status")
    created_at: datetime = Field(..., description="Creation timestamp")
    started_at: Optional[datetime] = Field(None, description="Start timestamp")
    completed_at: Optional[datetime] = Field(None, description="Completion timestamp")
    progress: Optional[Dict[str, Any]] = Field(None, description="Progress information")
    error: Optional[str] = Field(None, description="Error message if failed")
    result: Optional[OptimizationResult] = Field(None, description="Results if completed")


class EvaluationRequest(BaseModel):
    """Request to evaluate parameters for a study."""
    study_name: str = Field(..., description="Study name")
    trial_number: int = Field(..., description="Trial number")
    value: float = Field(..., description="Objective value")
    intermediate_values: Optional[Dict[int, float]] = Field(None, description="Intermediate values for pruning")


class SuggestRequest(BaseModel):
    """Request to get suggested parameters."""
    study_name: str = Field(..., description="Study name")


class SuggestResponse(BaseModel):
    """Response with suggested parameters."""
    trial_number: int = Field(..., description="Trial number")
    params: Dict[str, Union[str, int, float]] = Field(..., description="Suggested parameters")


class ErrorResponse(BaseModel):
    """Error response."""
    error: str = Field(..., description="Error message")
    detail: Optional[str] = Field(None, description="Error details")