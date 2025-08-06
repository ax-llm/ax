"""
MiPro adapter for the Python optimization service.

This module provides integration between the MiPro optimizer and the Python
Optuna-based optimization service, enabling sophisticated prompt optimization
with Bayesian optimization backends.
"""

import logging
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger(__name__)


class MiProParameterType(Enum):
    """MiPro-specific parameter types."""
    INSTRUCTION_VARIANT = "instruction_variant"
    DEMO_COUNT = "demo_count"
    TEMPERATURE = "temperature"
    SAMPLING_METHOD = "sampling_method"
    REASONING_STYLE = "reasoning_style"


@dataclass
class MiProParameter:
    """Enhanced parameter definition for MiPro optimization."""
    name: str
    param_type: MiProParameterType
    low: Optional[float] = None
    high: Optional[float] = None
    choices: Optional[List[Any]] = None
    step: Optional[float] = None
    log_scale: bool = False
    description: str = ""
    constraints: Optional[Dict[str, Any]] = None


@dataclass
class MiProConfiguration:
    """Configuration for MiPro optimization."""
    # Core MiPro parameters
    max_bootstrapped_demos: int = 3
    max_labeled_demos: int = 4
    num_candidates: int = 5
    num_trials: int = 30
    
    # Evaluation settings
    minibatch: bool = True
    minibatch_size: int = 25
    minibatch_full_eval_steps: int = 10
    
    # Proposer settings
    program_aware_proposer: bool = True
    data_aware_proposer: bool = True
    tip_aware_proposer: bool = True
    fewshot_aware_proposer: bool = True
    
    # Early stopping
    early_stopping_trials: int = 5
    min_improvement_threshold: float = 0.01
    
    # Bayesian optimization
    bayesian_optimization: bool = True
    acquisition_function: str = "expected_improvement"
    exploration_weight: float = 0.1
    
    # Self-consistency
    sample_count: int = 1
    
    # Optimization level presets
    optimization_level: Optional[str] = None  # "light", "medium", "heavy"


class MiProAdapter:
    """Adapter for integrating MiPro with the Python optimization service."""
    
    # Predefined parameter templates for common MiPro scenarios
    PARAMETER_TEMPLATES = {
        "instruction_generation": [
            MiProParameter(
                name="instruction_style",
                param_type=MiProParameterType.INSTRUCTION_VARIANT,
                choices=["concise", "detailed", "step_by_step", "reasoning_first", "examples_first"],
                description="Style of instruction generation"
            ),
            MiProParameter(
                name="instruction_temperature",
                param_type=MiProParameterType.TEMPERATURE,
                low=0.1,
                high=2.0,
                description="Temperature for instruction generation"
            ),
        ],
        "demo_selection": [
            MiProParameter(
                name="bootstrapped_demos",
                param_type=MiProParameterType.DEMO_COUNT,
                low=0,
                high=5,
                description="Number of bootstrapped demonstrations"
            ),
            MiProParameter(
                name="labeled_demos",
                param_type=MiProParameterType.DEMO_COUNT,
                low=0,
                high=5,
                description="Number of labeled examples"
            ),
        ],
        "reasoning": [
            MiProParameter(
                name="reasoning_style",
                param_type=MiProParameterType.REASONING_STYLE,
                choices=["chain_of_thought", "step_by_step", "direct", "analytical"],
                description="Reasoning approach for the model"
            ),
        ],
        "sampling": [
            MiProParameter(
                name="sampling_method",
                param_type=MiProParameterType.SAMPLING_METHOD,
                choices=["greedy", "top_k", "nucleus", "temperature"],
                description="Sampling method for generation"
            ),
            MiProParameter(
                name="sampling_temperature",
                param_type=MiProParameterType.TEMPERATURE,
                low=0.0,
                high=2.0,
                log_scale=True,
                description="Temperature for sampling"
            ),
        ],
    }
    
    def __init__(self, config: Optional[MiProConfiguration] = None):
        """Initialize the MiPro adapter."""
        self.config = config or MiProConfiguration()
        self._apply_optimization_level()
    
    def _apply_optimization_level(self) -> None:
        """Apply optimization level presets to configuration."""
        if not self.config.optimization_level:
            return
        
        level = self.config.optimization_level.lower()
        if level == "light":
            self.config.num_candidates = 3
            self.config.num_trials = 10
            self.config.minibatch_size = 20
        elif level == "medium":
            self.config.num_candidates = 5
            self.config.num_trials = 20
            self.config.minibatch_size = 25
        elif level == "heavy":
            self.config.num_candidates = 7
            self.config.num_trials = 30
            self.config.minibatch_size = 30
    
    def create_optimization_request(
        self,
        study_name: str,
        objective_name: str = "accuracy",
        objective_direction: str = "maximize",
        parameter_sets: Optional[List[str]] = None,
        custom_parameters: Optional[List[MiProParameter]] = None
    ) -> Dict[str, Any]:
        """
        Create an optimization request for the Python service.
        
        Args:
            study_name: Name of the optimization study
            objective_name: Name of the objective metric
            objective_direction: Direction of optimization ("minimize" or "maximize")
            parameter_sets: List of parameter template names to include
            custom_parameters: Additional custom parameters
        
        Returns:
            Dictionary representing the optimization request
        """
        parameters = []
        
        # Add parameters from templates
        if parameter_sets:
            for template_name in parameter_sets:
                if template_name in self.PARAMETER_TEMPLATES:
                    for param in self.PARAMETER_TEMPLATES[template_name]:
                        parameters.append(self._convert_parameter(param))
        
        # Add custom parameters
        if custom_parameters:
            for param in custom_parameters:
                parameters.append(self._convert_parameter(param))
        
        # Add configuration-based parameters
        if self.config.bayesian_optimization:
            parameters.extend(self._get_bayesian_parameters())
        
        return {
            "study_name": study_name,
            "parameters": parameters,
            "objective": {
                "name": objective_name,
                "direction": objective_direction
            },
            "n_trials": self.config.num_trials,
            "sampler": "TPESampler" if self.config.bayesian_optimization else "RandomSampler",
            "pruner": "MedianPruner" if self.config.minibatch else None,
            "metadata": {
                "optimizer_type": "MiPro",
                "config": self._serialize_config()
            }
        }
    
    def _convert_parameter(self, param: MiProParameter) -> Dict[str, Any]:
        """Convert MiProParameter to Optuna parameter format."""
        result = {"name": param.name}
        
        if param.choices:
            result["type"] = "categorical"
            result["choices"] = param.choices
        elif param.low is not None and param.high is not None:
            result["type"] = "float" if "." in str(param.low) or "." in str(param.high) else "int"
            result["low"] = param.low
            result["high"] = param.high
            if param.step:
                result["step"] = param.step
            if param.log_scale:
                result["log"] = True
        
        return result
    
    def _get_bayesian_parameters(self) -> List[Dict[str, Any]]:
        """Get Bayesian optimization specific parameters."""
        return [
            {
                "name": "exploration_weight",
                "type": "float",
                "low": 0.01,
                "high": 1.0,
                "log": True
            }
        ]
    
    def _serialize_config(self) -> Dict[str, Any]:
        """Serialize MiPro configuration for metadata."""
        return {
            "max_bootstrapped_demos": self.config.max_bootstrapped_demos,
            "max_labeled_demos": self.config.max_labeled_demos,
            "num_candidates": self.config.num_candidates,
            "minibatch": self.config.minibatch,
            "minibatch_size": self.config.minibatch_size,
            "bayesian_optimization": self.config.bayesian_optimization,
            "acquisition_function": self.config.acquisition_function,
            "optimization_level": self.config.optimization_level
        }
    
    def interpret_results(self, optimization_result: Dict[str, Any]) -> Dict[str, Any]:
        """
        Interpret optimization results for MiPro context.
        
        Args:
            optimization_result: Raw optimization result from the service
        
        Returns:
            MiPro-specific interpretation of results
        """
        best_params = optimization_result.get("best_params", {})
        
        interpretation = {
            "best_configuration": {
                "instruction": self._get_instruction_from_params(best_params),
                "bootstrapped_demos": best_params.get("bootstrapped_demos", 0),
                "labeled_demos": best_params.get("labeled_demos", 0),
                "temperature": best_params.get("temperature", 0.7),
                "reasoning_style": best_params.get("reasoning_style", "direct"),
            },
            "performance": {
                "best_score": optimization_result.get("best_value"),
                "total_trials": optimization_result.get("n_trials"),
                "convergence_trial": self._find_convergence_point(
                    optimization_result.get("trials", [])
                ),
            },
            "recommendations": self._generate_recommendations(best_params, optimization_result)
        }
        
        return interpretation
    
    def _get_instruction_from_params(self, params: Dict[str, Any]) -> str:
        """Generate instruction string from parameters."""
        style = params.get("instruction_style", "concise")
        reasoning = params.get("reasoning_style", "direct")
        
        instruction_templates = {
            ("concise", "direct"): "Analyze the input and provide a precise response.",
            ("concise", "chain_of_thought"): "Think step-by-step and provide a concise answer.",
            ("detailed", "direct"): "Examine the input thoroughly and provide a comprehensive, detailed response.",
            ("detailed", "chain_of_thought"): "Work through this problem step-by-step, showing your reasoning process in detail.",
            ("step_by_step", "direct"): "Break down the problem into steps and solve systematically.",
            ("step_by_step", "chain_of_thought"): "1. Understand the problem\n2. Break it down\n3. Solve each part\n4. Combine the solutions",
            ("reasoning_first", "direct"): "First explain your reasoning, then provide the answer.",
            ("reasoning_first", "chain_of_thought"): "Begin with your thought process, then work through to the solution.",
            ("examples_first", "direct"): "Consider similar examples, then apply the pattern to this case.",
            ("examples_first", "chain_of_thought"): "Review relevant examples, identify patterns, and apply them step-by-step.",
        }
        
        key = (style, reasoning)
        return instruction_templates.get(key, instruction_templates[("concise", "direct")])
    
    def _find_convergence_point(self, trials: List[Dict[str, Any]]) -> Optional[int]:
        """Find the trial number where optimization converged."""
        if len(trials) < 5:
            return None
        
        # Simple convergence detection: look for plateau in performance
        values = [t.get("value", 0) for t in trials if t.get("value") is not None]
        if len(values) < 5:
            return None
        
        # Check last 5 trials for minimal improvement
        for i in range(len(values) - 5, 0, -1):
            recent_values = values[i:i+5]
            if max(recent_values) - min(recent_values) < self.config.min_improvement_threshold:
                return i
        
        return None
    
    def _generate_recommendations(
        self, 
        best_params: Dict[str, Any], 
        result: Dict[str, Any]
    ) -> List[str]:
        """Generate actionable recommendations based on results."""
        recommendations = []
        
        # Check demo balance
        bootstrapped = best_params.get("bootstrapped_demos", 0)
        labeled = best_params.get("labeled_demos", 0)
        
        if bootstrapped == 0 and labeled == 0:
            recommendations.append(
                "Consider adding demonstrations - the model performed well without examples, "
                "but demos might improve consistency."
            )
        elif bootstrapped > labeled * 2:
            recommendations.append(
                "High bootstrapped-to-labeled ratio detected. Consider increasing labeled examples "
                "for better grounding."
            )
        
        # Check temperature
        temp = best_params.get("temperature", 0.7)
        if temp < 0.3:
            recommendations.append(
                "Low temperature suggests deterministic behavior is preferred. "
                "Consider using greedy decoding in production."
            )
        elif temp > 1.5:
            recommendations.append(
                "High temperature indicates creative/diverse outputs are beneficial. "
                "Consider implementing output validation."
            )
        
        # Check convergence
        convergence = self._find_convergence_point(result.get("trials", []))
        if convergence and convergence < self.config.num_trials * 0.5:
            recommendations.append(
                f"Optimization converged early (trial {convergence}/{self.config.num_trials}). "
                f"You could use fewer trials in future runs."
            )
        
        return recommendations
    
    def create_production_config(
        self, 
        optimization_result: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Create production-ready configuration from optimization results.
        
        Args:
            optimization_result: Results from optimization
        
        Returns:
            Configuration ready for production deployment
        """
        interpretation = self.interpret_results(optimization_result)
        best_config = interpretation["best_configuration"]
        
        return {
            "instruction": best_config["instruction"],
            "demos": {
                "bootstrapped": best_config["bootstrapped_demos"],
                "labeled": best_config["labeled_demos"]
            },
            "generation": {
                "temperature": best_config["temperature"],
                "reasoning_style": best_config["reasoning_style"],
                "max_retries": 3,
                "timeout": 30
            },
            "validation": {
                "min_confidence": 0.7,
                "require_reasoning": best_config["reasoning_style"] != "direct"
            },
            "metadata": {
                "optimization_score": interpretation["performance"]["best_score"],
                "optimization_trials": interpretation["performance"]["total_trials"],
                "created_from": "MiPro optimization"
            }
        }


def create_mipro_study(
    study_name: str,
    optimization_level: str = "medium",
    use_all_parameters: bool = False
) -> Dict[str, Any]:
    """
    Convenience function to create a MiPro optimization study.
    
    Args:
        study_name: Name for the study
        optimization_level: "light", "medium", or "heavy"
        use_all_parameters: Whether to include all parameter templates
    
    Returns:
        Optimization request dictionary
    """
    config = MiProConfiguration(optimization_level=optimization_level)
    adapter = MiProAdapter(config)
    
    parameter_sets = ["instruction_generation", "demo_selection"]
    if use_all_parameters:
        parameter_sets.extend(["reasoning", "sampling"])
    
    return adapter.create_optimization_request(
        study_name=study_name,
        parameter_sets=parameter_sets
    )