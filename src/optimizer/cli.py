#!/usr/bin/env python3
"""
Command-line interface for the Ax Optimizer Service.

This CLI provides easy access to all optimizer service functionality,
including server management, optimization job control, and MiPro integration.
"""

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional
import subprocess
import signal
import os

try:
    import httpx
    import uvicorn
    from tabulate import tabulate
    from rich.console import Console
    from rich.progress import Progress, SpinnerColumn, TextColumn
    from rich.table import Table
    from rich import print as rprint
except ImportError:
    print("Error: Required dependencies not installed.")
    print("Please run: pip install httpx tabulate rich")
    sys.exit(1)

console = Console()


class OptimizerCLI:
    """CLI for interacting with the Ax Optimizer Service."""

    def __init__(self, endpoint: str = "http://localhost:8000"):
        """Initialize CLI with service endpoint."""
        self.endpoint = endpoint.rstrip("/")
        self.client = httpx.Client(timeout=30.0)
        self.server_process = None

    def health_check(self) -> bool:
        """Check if the service is healthy."""
        try:
            response = self.client.get(f"{self.endpoint}/health")
            return response.status_code == 200
        except Exception:
            return False

    def start_server(self, host: str = "0.0.0.0", port: int = 8000, 
                    workers: int = 1, debug: bool = False) -> None:
        """Start the optimizer service."""
        console.print("[bold green]Starting Ax Optimizer Service...[/bold green]")
        
        # Check if already running
        if self.health_check():
            console.print("[yellow]Service is already running![/yellow]")
            return
        
        # Start the server
        cmd = [
            sys.executable, "-m", "uvicorn",
            "app.api:app",
            "--host", host,
            "--port", str(port),
            "--workers", str(workers)
        ]
        
        if debug:
            cmd.append("--reload")
            cmd.extend(["--log-level", "debug"])
        else:
            cmd.extend(["--log-level", "info"])
        
        # Start server in background
        env = os.environ.copy()
        env["PYTHONPATH"] = str(Path(__file__).parent)
        
        # Don't capture output so logs are displayed
        self.server_process = subprocess.Popen(
            cmd,
            env=env
        )
        
        # Wait for server to start
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            transient=True,
        ) as progress:
            task = progress.add_task("Waiting for server to start...", total=None)
            
            for _ in range(30):  # Wait up to 30 seconds
                if self.health_check():
                    progress.stop()
                    console.print("[bold green]✓ Server started successfully![/bold green]")
                    console.print(f"API docs available at: http://{host}:{port}/docs")
                    return
                time.sleep(1)
        
        console.print("[bold red]Failed to start server![/bold red]")
        if self.server_process:
            self.server_process.terminate()
            self.server_process = None

    def stop_server(self) -> None:
        """Stop the optimizer service."""
        if self.server_process:
            console.print("[yellow]Stopping server...[/yellow]")
            self.server_process.terminate()
            self.server_process.wait(timeout=5)
            self.server_process = None
            console.print("[green]Server stopped.[/green]")
        else:
            console.print("[yellow]No server process to stop.[/yellow]")

    def create_optimization(self, config_file: Optional[str] = None, **kwargs) -> Dict[str, Any]:
        """Create a new optimization job."""
        # Load config from file if provided
        if config_file:
            with open(config_file, 'r') as f:
                config = json.load(f)
        else:
            # Build config from kwargs
            config = self._build_optimization_config(**kwargs)
        
        # Send request
        response = self.client.post(
            f"{self.endpoint}/optimize",
            json=config
        )
        
        if response.status_code != 200:
            raise Exception(f"Failed to create optimization: {response.text}")
        
        return response.json()

    def _build_optimization_config(self, **kwargs) -> Dict[str, Any]:
        """Build optimization configuration from CLI arguments."""
        config = {
            "study_name": kwargs.get("study_name", f"study_{int(time.time())}"),
            "parameters": [],
            "objective": {
                "name": kwargs.get("objective", "score"),
                "direction": kwargs.get("direction", "maximize")
            },
            "n_trials": kwargs.get("n_trials", 30),
            "sampler": kwargs.get("sampler", "TPESampler"),
        }
        
        # Add pruner if specified
        if kwargs.get("pruner"):
            config["pruner"] = kwargs["pruner"]
        
        # Parse parameters if provided as string
        if kwargs.get("parameters"):
            params = kwargs["parameters"]
            if isinstance(params, str):
                # Simple format: "temperature:float:0.1:2.0,learning_rate:float:0.001:0.1:log"
                for param_spec in params.split(","):
                    parts = param_spec.split(":")
                    if len(parts) >= 4:
                        param = {
                            "name": parts[0],
                            "type": parts[1],
                            "low": float(parts[2]),
                            "high": float(parts[3])
                        }
                        if len(parts) > 4 and parts[4] == "log":
                            param["log"] = True
                        config["parameters"].append(param)
        
        return config

    def get_job_status(self, job_id: str) -> Dict[str, Any]:
        """Get status of an optimization job."""
        response = self.client.get(f"{self.endpoint}/jobs/{job_id}")
        
        if response.status_code != 200:
            raise Exception(f"Failed to get job status: {response.text}")
        
        return response.json()

    def list_jobs(self, limit: int = 10) -> list:
        """List recent optimization jobs."""
        response = self.client.get(f"{self.endpoint}/jobs", params={"limit": limit})
        
        if response.status_code != 200:
            raise Exception(f"Failed to list jobs: {response.text}")
        
        return response.json()

    def suggest_parameters(self, study_name: str) -> Dict[str, Any]:
        """Get parameter suggestions for a study."""
        response = self.client.post(f"{self.endpoint}/studies/{study_name}/suggest")
        
        if response.status_code != 200:
            raise Exception(f"Failed to get suggestions: {response.text}")
        
        return response.json()

    def evaluate_trial(self, study_name: str, trial_number: int, value: float) -> None:
        """Report trial evaluation result."""
        response = self.client.post(
            f"{self.endpoint}/studies/{study_name}/evaluate",
            json={
                "study_name": study_name,
                "trial_number": trial_number,
                "value": value
            }
        )
        
        if response.status_code != 200:
            raise Exception(f"Failed to evaluate trial: {response.text}")

    def get_results(self, study_name: str) -> Dict[str, Any]:
        """Get optimization results for a study."""
        response = self.client.get(f"{self.endpoint}/studies/{study_name}/results")
        
        if response.status_code != 200:
            raise Exception(f"Failed to get results: {response.text}")
        
        return response.json()

    def create_mipro_config(self, output_file: str = "mipro_config.json") -> None:
        """Create a sample MiPro optimization configuration."""
        config = {
            "study_name": "mipro_optimization",
            "parameters": [
                {
                    "name": "temperature",
                    "type": "float",
                    "low": 0.1,
                    "high": 2.0
                },
                {
                    "name": "num_candidates",
                    "type": "int",
                    "low": 3,
                    "high": 10
                },
                {
                    "name": "max_bootstrapped_demos",
                    "type": "int",
                    "low": 0,
                    "high": 5
                },
                {
                    "name": "max_labeled_demos",
                    "type": "int",
                    "low": 0,
                    "high": 5
                },
                {
                    "name": "minibatch_size",
                    "type": "int",
                    "low": 10,
                    "high": 50,
                    "step": 5
                }
            ],
            "objective": {
                "name": "accuracy",
                "direction": "maximize"
            },
            "n_trials": 50,
            "sampler": "TPESampler",
            "pruner": "MedianPruner",
            "metadata": {
                "optimizer_type": "MiPro",
                "description": "MiPro hyperparameter optimization for LLM prompt tuning"
            }
        }
        
        with open(output_file, 'w') as f:
            json.dump(config, f, indent=2)
        
        console.print(f"[green]Created MiPro configuration file: {output_file}[/green]")
        console.print("\nConfiguration includes parameters for:")
        console.print("  • Temperature (model randomness)")
        console.print("  • Number of instruction candidates")
        console.print("  • Bootstrapped demo count")
        console.print("  • Labeled demo count")
        console.print("  • Minibatch size for evaluation")

    def monitor_job(self, job_id: str, interval: int = 2) -> None:
        """Monitor a job until completion."""
        console.print(f"[bold]Monitoring job {job_id}...[/bold]")
        
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console
        ) as progress:
            task = progress.add_task("Waiting for optimization to complete...", total=None)
            
            while True:
                try:
                    status = self.get_job_status(job_id)
                    
                    if status["status"] in ["completed", "failed", "cancelled"]:
                        progress.stop()
                        self._display_job_status(status)
                        
                        if status["status"] == "completed" and status.get("result"):
                            self._display_results(status["result"])
                        
                        break
                    
                    progress.update(task, description=f"Status: {status['status']}...")
                    time.sleep(interval)
                    
                except KeyboardInterrupt:
                    progress.stop()
                    console.print("\n[yellow]Monitoring cancelled by user.[/yellow]")
                    break
                except Exception as e:
                    progress.stop()
                    console.print(f"[red]Error: {e}[/red]")
                    break

    def _display_job_status(self, status: Dict[str, Any]) -> None:
        """Display job status in a formatted table."""
        table = Table(title="Job Status", show_header=True)
        table.add_column("Field", style="cyan")
        table.add_column("Value", style="white")
        
        table.add_row("Job ID", status["job_id"])
        table.add_row("Study Name", status["study_name"])
        table.add_row("Status", status["status"])
        table.add_row("Created", status.get("created_at", "N/A"))
        table.add_row("Started", status.get("started_at", "N/A"))
        table.add_row("Completed", status.get("completed_at", "N/A"))
        
        if status.get("error"):
            table.add_row("Error", status["error"])
        
        console.print(table)

    def _display_results(self, results: Dict[str, Any]) -> None:
        """Display optimization results."""
        console.print("\n[bold green]Optimization Results:[/bold green]")
        
        if results.get("best_trial"):
            best = results["best_trial"]
            console.print(f"\n[cyan]Best Trial:[/cyan]")
            console.print(f"  Value: {best.get('value', 'N/A')}")
            console.print(f"  Parameters:")
            for key, value in best.get("params", {}).items():
                console.print(f"    • {key}: {value}")
        
        console.print(f"\n[cyan]Summary:[/cyan]")
        console.print(f"  Total Trials: {results.get('n_trials', 0)}")
        console.print(f"  Direction: {results.get('direction', 'N/A')}")
        console.print(f"  Best Value: {results.get('best_value', 'N/A')}")


def main():
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Ax Optimizer Service CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Start the server
  ax-optimizer server start --debug
  
  # Create a MiPro optimization job
  ax-optimizer optimize --config mipro_config.json
  
  # Monitor a job
  ax-optimizer monitor <job_id>
  
  # List recent jobs
  ax-optimizer list
  
  # Get optimization results
  ax-optimizer results <study_name>
        """
    )
    
    parser.add_argument(
        "--endpoint",
        default="http://localhost:8000",
        help="Service endpoint URL"
    )
    
    subparsers = parser.add_subparsers(dest="command", help="Available commands")
    
    # Server management
    server_parser = subparsers.add_parser("server", help="Server management")
    server_sub = server_parser.add_subparsers(dest="server_command")
    
    start_parser = server_sub.add_parser("start", help="Start the server")
    start_parser.add_argument("--host", default="0.0.0.0", help="Host to bind")
    start_parser.add_argument("--port", type=int, default=8000, help="Port to bind")
    start_parser.add_argument("--workers", type=int, default=1, help="Number of workers")
    start_parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    
    server_sub.add_parser("stop", help="Stop the server")
    server_sub.add_parser("status", help="Check server status")
    
    # Optimization commands
    optimize_parser = subparsers.add_parser("optimize", help="Create optimization job")
    optimize_parser.add_argument("--config", help="Configuration file (JSON)")
    optimize_parser.add_argument("--study-name", help="Study name")
    optimize_parser.add_argument("--n-trials", type=int, default=30, help="Number of trials")
    optimize_parser.add_argument("--objective", default="score", help="Objective name")
    optimize_parser.add_argument("--direction", choices=["minimize", "maximize"], 
                                default="maximize", help="Optimization direction")
    optimize_parser.add_argument("--sampler", choices=["TPESampler", "RandomSampler", "CmaEsSampler"],
                                default="TPESampler", help="Sampling algorithm")
    optimize_parser.add_argument("--pruner", choices=["MedianPruner", "SuccessiveHalvingPruner", "HyperbandPruner"],
                                help="Pruning algorithm")
    optimize_parser.add_argument("--parameters", help="Parameters spec (name:type:low:high)")
    optimize_parser.add_argument("--monitor", action="store_true", help="Monitor job after creation")
    
    # Job management
    list_parser = subparsers.add_parser("list", help="List jobs")
    list_parser.add_argument("--limit", type=int, default=10, help="Number of jobs to list")
    
    status_parser = subparsers.add_parser("status", help="Get job status")
    status_parser.add_argument("job_id", help="Job ID")
    
    monitor_parser = subparsers.add_parser("monitor", help="Monitor job progress")
    monitor_parser.add_argument("job_id", help="Job ID")
    monitor_parser.add_argument("--interval", type=int, default=2, help="Update interval in seconds")
    
    # Study management
    suggest_parser = subparsers.add_parser("suggest", help="Get parameter suggestions")
    suggest_parser.add_argument("study_name", help="Study name")
    
    evaluate_parser = subparsers.add_parser("evaluate", help="Report trial result")
    evaluate_parser.add_argument("study_name", help="Study name")
    evaluate_parser.add_argument("trial_number", type=int, help="Trial number")
    evaluate_parser.add_argument("value", type=float, help="Objective value")
    
    results_parser = subparsers.add_parser("results", help="Get optimization results")
    results_parser.add_argument("study_name", help="Study name")
    
    # MiPro specific
    mipro_parser = subparsers.add_parser("mipro", help="MiPro-specific commands")
    mipro_sub = mipro_parser.add_subparsers(dest="mipro_command")
    
    config_parser = mipro_sub.add_parser("create-config", help="Create MiPro configuration")
    config_parser.add_argument("--output", default="mipro_config.json", help="Output file")
    
    # Parse arguments
    args = parser.parse_args()
    
    # Initialize CLI
    cli = OptimizerCLI(endpoint=args.endpoint)
    
    try:
        # Handle commands
        if args.command == "server":
            if args.server_command == "start":
                cli.start_server(
                    host=args.host,
                    port=args.port,
                    workers=args.workers,
                    debug=args.debug
                )
                # Keep server running
                try:
                    while True:
                        time.sleep(1)
                except KeyboardInterrupt:
                    cli.stop_server()
            elif args.server_command == "stop":
                cli.stop_server()
            elif args.server_command == "status":
                if cli.health_check():
                    console.print("[green]✓ Server is running[/green]")
                else:
                    console.print("[red]✗ Server is not running[/red]")
        
        elif args.command == "optimize":
            result = cli.create_optimization(
                config_file=args.config,
                study_name=args.study_name,
                n_trials=args.n_trials,
                objective=args.objective,
                direction=args.direction,
                sampler=args.sampler,
                pruner=args.pruner,
                parameters=args.parameters
            )
            console.print(f"[green]Created optimization job: {result['job_id']}[/green]")
            console.print(f"Study name: {result['study_name']}")
            
            if args.monitor:
                cli.monitor_job(result['job_id'])
        
        elif args.command == "list":
            jobs = cli.list_jobs(limit=args.limit)
            if jobs:
                table = Table(title="Recent Jobs", show_header=True)
                table.add_column("Job ID", style="cyan")
                table.add_column("Study Name", style="white")
                table.add_column("Status", style="yellow")
                table.add_column("Created", style="green")
                
                for job in jobs:
                    table.add_row(
                        job["job_id"][:8] + "...",
                        job["study_name"],
                        job["status"],
                        job.get("created_at", "N/A")
                    )
                
                console.print(table)
            else:
                console.print("[yellow]No jobs found.[/yellow]")
        
        elif args.command == "status":
            status = cli.get_job_status(args.job_id)
            cli._display_job_status(status)
        
        elif args.command == "monitor":
            cli.monitor_job(args.job_id, interval=args.interval)
        
        elif args.command == "suggest":
            result = cli.suggest_parameters(args.study_name)
            console.print(f"[cyan]Trial #{result['trial_number']}[/cyan]")
            console.print("Suggested parameters:")
            for key, value in result["params"].items():
                console.print(f"  • {key}: {value}")
        
        elif args.command == "evaluate":
            cli.evaluate_trial(args.study_name, args.trial_number, args.value)
            console.print("[green]Trial result reported successfully.[/green]")
        
        elif args.command == "results":
            results = cli.get_results(args.study_name)
            cli._display_results(results)
        
        elif args.command == "mipro":
            if args.mipro_command == "create-config":
                cli.create_mipro_config(output_file=args.output)
        
        else:
            parser.print_help()
    
    except Exception as e:
        console.print(f"[bold red]Error: {e}[/bold red]")
        sys.exit(1)
    finally:
        cli.client.close()


if __name__ == "__main__":
    main()