#!/usr/bin/env python3
"""
Simple test script for the Ax Optimizer Service API.
"""

import asyncio
import json
import httpx
from datetime import datetime


async def test_optimizer_api():
    """Test the optimizer API endpoints."""
    base_url = "http://localhost:8000"
    
    async with httpx.AsyncClient() as client:
        try:
            # Test health check
            print("Testing health check...")
            response = await client.get(f"{base_url}/health")
            print(f"Health: {response.status_code} - {response.json()}")
            
            # Test optimization job creation
            print("\nTesting optimization job creation...")
            optimization_request = {
                "study_name": "test_study",
                "parameters": [
                    {
                        "name": "learning_rate",
                        "type": "float",
                        "low": 0.001,
                        "high": 0.1,
                        "log": True
                    },
                    {
                        "name": "batch_size",
                        "type": "int",
                        "low": 16,
                        "high": 128,
                        "step": 16
                    },
                    {
                        "name": "optimizer",
                        "type": "categorical",
                        "choices": ["adam", "sgd", "rmsprop"]
                    }
                ],
                "objective": {
                    "name": "accuracy",
                    "direction": "maximize"
                },
                "n_trials": 10,
                "sampler": "TPESampler",
                "pruner": "MedianPruner"
            }
            
            response = await client.post(
                f"{base_url}/optimize",
                json=optimization_request,
                timeout=10.0
            )
            
            if response.status_code == 200:
                job_data = response.json()
                job_id = job_data["job_id"]
                study_name = job_data["study_name"]
                print(f"Created job: {job_id}")
                
                # Test job status
                print(f"\nTesting job status...")
                status_response = await client.get(f"{base_url}/jobs/{job_id}")
                print(f"Job status: {status_response.status_code} - {status_response.json()}")
                
                # Test parameter suggestion
                print(f"\nTesting parameter suggestion...")
                suggest_response = await client.post(f"{base_url}/studies/{study_name}/suggest")
                if suggest_response.status_code == 200:
                    suggestion = suggest_response.json()
                    print(f"Suggested parameters: {suggestion}")
                    
                    # Test evaluation
                    print(f"\nTesting parameter evaluation...")
                    eval_request = {
                        "study_name": study_name,
                        "trial_number": suggestion["trial_number"],
                        "value": 0.85
                    }
                    eval_response = await client.post(
                        f"{base_url}/studies/{study_name}/evaluate",
                        json=eval_request
                    )
                    print(f"Evaluation: {eval_response.status_code} - {eval_response.json()}")
                else:
                    print(f"Suggestion failed: {suggest_response.status_code} - {suggest_response.text}")
                
                # Test study results
                print(f"\nTesting study results...")
                results_response = await client.get(f"{base_url}/studies/{study_name}/results")
                if results_response.status_code == 200:
                    results = results_response.json()
                    print(f"Study results: {json.dumps(results, indent=2)}")
                else:
                    print(f"Results failed: {results_response.status_code} - {results_response.text}")
                
            else:
                print(f"Optimization creation failed: {response.status_code} - {response.text}")
            
            # Test studies list
            print(f"\nTesting studies list...")
            studies_response = await client.get(f"{base_url}/studies")
            print(f"Studies: {studies_response.status_code} - {studies_response.json()}")
            
        except Exception as e:
            print(f"Test failed: {e}")


if __name__ == "__main__":
    print("Ax Optimizer Service API Test")
    print("=" * 40)
    print("Make sure the service is running on http://localhost:8000")
    print("Start with: docker-compose up -d")
    print()
    
    asyncio.run(test_optimizer_api())