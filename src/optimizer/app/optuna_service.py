import logging
from datetime import datetime
from typing import Dict, List, Optional, Union
import uuid

import optuna
from optuna import Trial as OptunaTrial
from optuna.samplers import TPESampler, RandomSampler, CmaEsSampler
from optuna.pruners import MedianPruner, SuccessiveHalvingPruner, HyperbandPruner

from .config import settings
from .models import (
    OptimizationRequest,
    OptimizationResult,
    Parameter,
    ParameterType,
    OptimizationDirection,
    Trial,
)

logger = logging.getLogger(__name__)


class OptunaService:
    """Service for managing Optuna studies and optimization."""
    
    def __init__(self):
        self.studies: Dict[str, optuna.Study] = {}
        self.active_trials: Dict[str, Dict[int, OptunaTrial]] = {}
    
    def _get_storage_url(self) -> Optional[str]:
        """Get storage URL for persistence."""
        if settings.USE_MEMORY_STORAGE:
            return None
        return settings.DATABASE_URL
    
    def _create_sampler(self, sampler_name: str) -> optuna.samplers.BaseSampler:
        """Create Optuna sampler from name."""
        samplers = {
            "TPESampler": TPESampler(),
            "RandomSampler": RandomSampler(),
            "CmaEsSampler": CmaEsSampler(),
        }
        return samplers.get(sampler_name, TPESampler())
    
    def _create_pruner(self, pruner_name: Optional[str]) -> Optional[optuna.pruners.BasePruner]:
        """Create Optuna pruner from name."""
        if not pruner_name:
            return None
        
        pruners = {
            "MedianPruner": MedianPruner(),
            "SuccessiveHalvingPruner": SuccessiveHalvingPruner(),
            "HyperbandPruner": HyperbandPruner(),
        }
        return pruners.get(pruner_name)
    
    def create_study(self, request: OptimizationRequest) -> str:
        """Create a new Optuna study."""
        study_name = request.study_name or f"study_{uuid.uuid4().hex[:8]}"
        
        direction = "minimize" if request.objective.direction == OptimizationDirection.MINIMIZE else "maximize"
        sampler = self._create_sampler(request.sampler)
        pruner = self._create_pruner(request.pruner)
        storage = self._get_storage_url()
        
        try:
            study = optuna.create_study(
                study_name=study_name,
                direction=direction,
                sampler=sampler,
                pruner=pruner,
                storage=storage,
                load_if_exists=True
            )
            
            self.studies[study_name] = study
            self.active_trials[study_name] = {}
            
            logger.info(f"Created study: {study_name}")
            return study_name
            
        except Exception as e:
            logger.error(f"Failed to create study {study_name}: {e}")
            raise
    
    def get_study(self, study_name: str) -> Optional[optuna.Study]:
        """Get existing study."""
        if study_name in self.studies:
            return self.studies[study_name]
        
        # Try to load from storage if not in memory
        storage = self._get_storage_url()
        if storage:
            try:
                study = optuna.load_study(study_name=study_name, storage=storage)
                self.studies[study_name] = study
                if study_name not in self.active_trials:
                    self.active_trials[study_name] = {}
                return study
            except Exception as e:
                logger.warning(f"Failed to load study {study_name}: {e}")
        
        return None
    
    def suggest_parameters(self, study_name: str) -> Optional[Dict[str, Union[str, int, float]]]:
        """Get suggested parameters for next trial."""
        study = self.get_study(study_name)
        if not study:
            return None
        
        trial = study.ask()
        trial_number = trial.number
        
        # Store active trial
        if study_name not in self.active_trials:
            self.active_trials[study_name] = {}
        self.active_trials[study_name][trial_number] = trial
        
        return {"trial_number": trial_number, "params": trial.params}
    
    def report_trial_result(
        self, 
        study_name: str, 
        trial_number: int, 
        value: float,
        intermediate_values: Optional[Dict[int, float]] = None
    ) -> bool:
        """Report trial result to study."""
        study = self.get_study(study_name)
        if not study:
            return False
        
        trial = self.active_trials.get(study_name, {}).get(trial_number)
        if not trial:
            logger.warning(f"Trial {trial_number} not found for study {study_name}")
            return False
        
        try:
            # Report intermediate values if provided
            if intermediate_values:
                for step, val in intermediate_values.items():
                    trial.report(val, step)
                    if trial.should_prune():
                        study.tell(trial, state=optuna.trial.TrialState.PRUNED)
                        return True
            
            # Report final value
            study.tell(trial, value)
            
            # Remove from active trials
            if study_name in self.active_trials and trial_number in self.active_trials[study_name]:
                del self.active_trials[study_name][trial_number]
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to report trial result: {e}")
            return False
    
    def _convert_optuna_trial(self, trial: OptunaTrial) -> Trial:
        """Convert Optuna trial to our Trial model."""
        return Trial(
            number=trial.number,
            value=trial.value,
            params=trial.params,
            state=trial.state.name,
            datetime_start=trial.datetime_start,
            datetime_complete=trial.datetime_complete,
            duration=trial.duration.total_seconds() if trial.duration else None
        )
    
    def get_optimization_result(self, study_name: str) -> Optional[OptimizationResult]:
        """Get optimization results for a study."""
        study = self.get_study(study_name)
        if not study:
            return None
        
        trials = [self._convert_optuna_trial(trial) for trial in study.trials]
        
        best_trial = None
        best_value = None
        best_params = None
        
        if study.best_trial:
            best_trial = self._convert_optuna_trial(study.best_trial)
            best_value = study.best_value
            best_params = study.best_params
        
        direction = OptimizationDirection.MINIMIZE if study.direction.name == "MINIMIZE" else OptimizationDirection.MAXIMIZE
        
        return OptimizationResult(
            study_name=study_name,
            best_trial=best_trial,
            best_value=best_value,
            best_params=best_params,
            trials=trials,
            n_trials=len(trials),
            direction=direction
        )
    
    def run_optimization(self, request: OptimizationRequest, study_name: str) -> OptimizationResult:
        """Run complete optimization (for synchronous execution)."""
        study = self.get_study(study_name)
        if not study:
            raise ValueError(f"Study {study_name} not found")
        
        # Define objective function that will be called by external evaluator
        def objective(trial: OptunaTrial) -> float:
            # This is a placeholder - in practice, the objective function
            # will be evaluated externally via the API
            params = {}
            for param in request.parameters:
                if param.type == ParameterType.FLOAT:
                    if param.log:
                        value = trial.suggest_float(param.name, param.low, param.high, log=True)
                    else:
                        value = trial.suggest_float(param.name, param.low, param.high, step=param.step)
                elif param.type == ParameterType.INT:
                    if param.log:
                        value = trial.suggest_int(param.name, param.low, param.high, log=True)
                    else:
                        value = trial.suggest_int(param.name, param.low, param.high, step=param.step)
                elif param.type == ParameterType.CATEGORICAL:
                    value = trial.suggest_categorical(param.name, param.choices)
                params[param.name] = value
            
            # Return a placeholder value - this should be replaced by external evaluation
            return 0.0
        
        # Note: In practice, this would be run asynchronously with external evaluation
        # study.optimize(objective, n_trials=request.n_trials, timeout=request.timeout)
        
        return self.get_optimization_result(study_name)
    
    def delete_study(self, study_name: str) -> bool:
        """Delete a study."""
        try:
            if study_name in self.studies:
                del self.studies[study_name]
            if study_name in self.active_trials:
                del self.active_trials[study_name]
            
            # Delete from storage if using persistence
            storage = self._get_storage_url()
            if storage:
                optuna.delete_study(study_name=study_name, storage=storage)
            
            logger.info(f"Deleted study: {study_name}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to delete study {study_name}: {e}")
            return False
    
    def list_studies(self) -> List[str]:
        """List all study names."""
        study_names = list(self.studies.keys())
        
        # Add studies from storage if using persistence
        storage = self._get_storage_url()
        if storage:
            try:
                storage_studies = optuna.get_all_study_summaries(storage=storage)
                for summary in storage_studies:
                    if summary.study_name not in study_names:
                        study_names.append(summary.study_name)
            except Exception as e:
                logger.warning(f"Failed to list studies from storage: {e}")
        
        return study_names


# Global service instance
optuna_service = OptunaService()