"""
Automatically generates a Postman Collection v2.1 JSON file (`postman_collection.json`)
by introspecting all registered FastAPI routes, Pydantic request schemas, and the
configured Bearer token in `.env`.

Usage:
    python generate_postman.py
"""

import json
import uuid
from pathlib import Path
from typing import Any, Dict, List

from app.core.config import app_settings
from app.main import app

OUTPUT_FILE = Path("postman_collection.json")
DEFAULT_BASE_URL = "http://127.0.0.1:8000"


def _resolve_ref(ref: str, openapi_schema: Dict[str, Any]) -> Dict[str, Any]:
    """Resolve an OpenAPI $ref pointer (e.g., '#/components/schemas/DownloadRequest')."""
    parts = ref.lstrip("#/").split("/")
    current: Any = openapi_schema
    for part in parts:
        current = current.get(part, {})
    return current


def _build_example_from_schema(
    schema: Dict[str, Any], openapi_schema: Dict[str, Any]
) -> Any:
    """Recursively construct an example JSON payload from an OpenAPI/Pydantic schema."""
    if "$ref" in schema:
        schema = _resolve_ref(schema["$ref"], openapi_schema)

    if "example" in schema:
        return schema["example"]
    if "examples" in schema and isinstance(schema["examples"], list) and schema["examples"]:
        return schema["examples"][0]
    if "default" in schema:
        return schema["default"]

    if "anyOf" in schema:
        for sub_schema in schema["anyOf"]:
            if sub_schema.get("type") != "null":
                return _build_example_from_schema(sub_schema, openapi_schema)

    schema_type = schema.get("type", "object")

    if schema_type == "object":
        result: Dict[str, Any] = {}
        properties = schema.get("properties", {})
        for prop_name, prop_schema in properties.items():
            if "examples" in prop_schema or "example" in prop_schema:
                result[prop_name] = _build_example_from_schema(prop_schema, openapi_schema)
            elif "url" in prop_name.lower() or "shortcode" in prop_name.lower():
                result[prop_name] = "https://www.instagram.com/p/DK47CuHSbjl/"
            else:
                result[prop_name] = _build_example_from_schema(prop_schema, openapi_schema)
        return result

    if schema_type == "array":
        item_schema = schema.get("items", {})
        return [_build_example_from_schema(item_schema, openapi_schema)]

    if schema_type == "string":
        return "string"
    if schema_type == "integer":
        return 0
    if schema_type == "number":
        return 0.0
    if schema_type == "boolean":
        return True

    return ""


def generate_postman_collection(
    base_url: str = DEFAULT_BASE_URL,
    output_path: Path = OUTPUT_FILE,
) -> Path:
    """Introspect the FastAPI app OpenAPI schema and export a Postman v2.1 collection."""
    openapi_schema = app.openapi()
    folders: Dict[str, List[Dict[str, Any]]] = {}

    paths = openapi_schema.get("paths", {})
    for route_path, path_methods in paths.items():
        for http_method, operation in path_methods.items():
            method_upper = http_method.upper()
            if method_upper not in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
                continue

            tags = operation.get("tags") or ["General"]
            folder_name = tags[0]
            summary = operation.get("summary") or operation.get("operationId") or f"{method_upper} {route_path}"
            description = operation.get("description") or summary

            path_segments = [seg for seg in route_path.strip("/").split("/") if seg]

            # Build query parameters if defined on the endpoint
            query_params: List[Dict[str, Any]] = []
            for param in operation.get("parameters", []):
                if param.get("in") == "query":
                    param_schema = param.get("schema", {})
                    query_params.append(
                        {
                            "key": param.get("name"),
                            "value": str(_build_example_from_schema(param_schema, openapi_schema)),
                            "description": param.get("description", ""),
                            "disabled": not param.get("required", False),
                        }
                    )

            headers: List[Dict[str, str]] = [
                {
                    "key": "Authorization",
                    "value": "Bearer {{bearer_token}}",
                    "type": "text",
                }
            ]

            # Build request body if endpoint accepts a JSON or multipart payload
            body_block: Dict[str, Any] | None = None
            request_body = operation.get("requestBody", {})
            content_map = request_body.get("content", {})
            json_content = content_map.get("application/json", {}).get("schema")
            multipart_content = content_map.get("multipart/form-data", {}).get("schema")
            if json_content:
                headers.append(
                    {
                        "key": "Content-Type",
                        "value": "application/json",
                        "type": "text",
                    }
                )
                example_payload = _build_example_from_schema(json_content, openapi_schema)
                body_block = {
                    "mode": "raw",
                    "raw": json.dumps(example_payload, indent=2),
                    "options": {"raw": {"language": "json"}},
                }
            elif multipart_content:
                resolved_mp = (
                    _resolve_ref(multipart_content["$ref"], openapi_schema)
                    if "$ref" in multipart_content
                    else multipart_content
                )
                formdata_items = [
                    {
                        "key": prop_name,
                        "type": "file" if prop_schema.get("format") == "binary" else "text",
                        "src": [],
                        "description": prop_schema.get("description", ""),
                    }
                    for prop_name, prop_schema in resolved_mp.get("properties", {}).items()
                ]
                body_block = {
                    "mode": "formdata",
                    "formdata": formdata_items,
                }

            request_dict: Dict[str, Any] = {
                "auth": {
                    "type": "bearer",
                    "bearer": [
                        {
                            "key": "token",
                            "value": "{{bearer_token}}",
                            "type": "string",
                        }
                    ],
                },
                "method": method_upper,
                "header": headers,
                "url": {
                    "raw": "{{base_url}}" + route_path,
                    "host": ["{{base_url}}"],
                    "path": path_segments,
                    "query": query_params,
                },
                "description": description,
            }

            if body_block is not None:
                request_dict["body"] = body_block

            item_entry = {
                "name": summary,
                "request": request_dict,
                "response": [],
            }
            folders.setdefault(folder_name, []).append(item_entry)

    collection = {
        "info": {
            "_postman_id": str(uuid.uuid4()),
            "name": app_settings.APP_NAME,
            "description": f"Auto-generated Postman collection for {app_settings.APP_NAME} (v{app_settings.APP_VERSION})",
            "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        "auth": {
            "type": "bearer",
            "bearer": [
                {
                    "key": "token",
                    "value": "{{bearer_token}}",
                    "type": "string",
                }
            ],
        },
        "variable": [
            {
                "key": "base_url",
                "value": base_url,
                "type": "string",
            },
            {
                "key": "bearer_token",
                "value": app_settings.HEADER_TOKEN,
                "type": "string",
            },
        ],
        "item": [
            {
                "name": folder,
                "item": items,
            }
            for folder, items in folders.items()
        ],
    }

    output_path.write_text(json.dumps(collection, indent=2), encoding="utf-8")
    return output_path


if __name__ == "__main__":
    saved_path = generate_postman_collection()
    print(f"Postman collection successfully generated at: {saved_path.resolve()}")

