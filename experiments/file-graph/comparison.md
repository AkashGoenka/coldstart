# Standalone vs coldstart: arches file-dependency graph

## Node universe (.py, shared exclusions)

- standalone files: **263**
- coldstart .py files: **261**
- shared universe (compared on): **261**
- only standalone saw: 2  |  only coldstart saw: 0
  - e.g. standalone-only: ['arches/install/arches-templates/project_name/logs/__init__.py', 'arches/logs/__init__.py']

## Edge agreement

- standalone edges: **1035**
- coldstart edges: **1010**
- agreed (in both): **1001**
- standalone-only (coldstart missed): **34**
- coldstart-only (standalone missed): **9**
- **Jaccard similarity: 0.959**

## Edges coldstart missed (sample of standalone-only)

- `arches/__init__.py` -> `arches/celery.py`
- `arches/app/datatypes/base.py` -> `arches/app/utils/betterJSONSerializer.py`
- `arches/app/datatypes/datatypes.py` -> `arches/app/models/resource.py`
- `arches/app/etl_modules/bulk_edit_concept.py` -> `arches/app/utils/i18n.py`
- `arches/app/etl_modules/tile_excel_exporter.py` -> `arches/app/datatypes/datatypes.py`
- `arches/app/models/fields/i18n.py` -> `arches/app/utils/betterJSONSerializer.py`
- `arches/app/models/models.py` -> `arches/app/datatypes/datatypes.py`
- `arches/app/models/models.py` -> `arches/app/utils/permission_backend.py`
- `arches/app/models/querysets/graph.py` -> `arches/app/models/__init__.py`
- `arches/app/models/querysets/graph.py` -> `arches/app/models/models.py`
- `arches/app/models/resource.py` -> `arches/app/models/tile.py`
- `arches/app/models/system_settings.py` -> `arches/app/datatypes/datatypes.py`
- `arches/app/models/utils.py` -> `arches/app/models/system_settings.py`
- `arches/app/search/mappings.py` -> `arches/app/datatypes/datatypes.py`
- `arches/app/tasks.py` -> `arches/app/etl_modules/__init__.py`
- `arches/app/tasks.py` -> `arches/app/etl_modules/base_data_editor.py`
- `arches/app/tasks.py` -> `arches/app/etl_modules/base_import_module.py`
- `arches/app/tasks.py` -> `arches/app/etl_modules/branch_excel_exporter.py`
- `arches/app/tasks.py` -> `arches/app/etl_modules/branch_excel_importer.py`
- `arches/app/tasks.py` -> `arches/app/etl_modules/bulk_data_deletion.py`
- `arches/app/tasks.py` -> `arches/app/etl_modules/bulk_edit_concept.py`
- `arches/app/tasks.py` -> `arches/app/etl_modules/import_single_csv.py`
- `arches/app/tasks.py` -> `arches/app/etl_modules/jsonld_importer.py`
- `arches/app/tasks.py` -> `arches/app/etl_modules/tile_excel_exporter.py`
- `arches/app/tasks.py` -> `arches/app/etl_modules/tile_excel_importer.py`
- `arches/app/tasks.py` -> `arches/app/models/resource.py`
- `arches/app/tasks.py` -> `arches/app/models/system_settings.py`
- `arches/app/tasks.py` -> `arches/app/search/search_export.py`
- `arches/app/utils/i18n.py` -> `arches/app/models/graph.py`
- `arches/app/utils/permission_backend.py` -> `arches/app/permissions/arches_default_allow.py`

## Edges only coldstart found (sample of coldstart-only)

- `arches/app/tasks.py` -> `arches/celery.py`
- `arches/app/views/etl_manager.py` -> `arches/celery.py`
- `arches/settings.py` -> `arches/__init__.py`
- `arches/settings.py` -> `arches/app/permissions/arches_permission_base.py`
- `arches/settings.py` -> `arches/app/utils/email_auth_backend.py`
- `arches/settings.py` -> `arches/app/utils/external_oauth_backend.py`
- `arches/settings.py` -> `arches/app/utils/middleware.py`
- `arches/settings.py` -> `arches/urls.py`
- `arches/settings.py` -> `arches/wsgi.py`

## Top hubs by in-degree (most depended-upon)

### standalone
-  118  arches/app/models/models.py
-  105  arches/app/models/system_settings.py
-   74  arches/app/models/__init__.py
-   61  arches/app/utils/betterJSONSerializer.py
-   41  arches/app/utils/response.py
-   37  arches/app/utils/permission_backend.py
-   33  arches/app/search/elasticsearch_dsl_builder.py
-   32  arches/app/datatypes/datatypes.py
-   27  arches/app/models/resource.py
-   23  arches/app/search/search_engine_factory.py
-   21  arches/app/views/api/__init__.py
-   18  arches/app/search/mappings.py
-   17  arches/app/search/components/base.py
-   16  arches/app/models/concept.py
-   16  arches/app/utils/decorators.py

### coldstart
-  117  arches/app/models/models.py
-  103  arches/app/models/system_settings.py
-   73  arches/app/models/__init__.py
-   59  arches/app/utils/betterJSONSerializer.py
-   41  arches/app/utils/response.py
-   36  arches/app/utils/permission_backend.py
-   33  arches/app/search/elasticsearch_dsl_builder.py
-   28  arches/app/datatypes/datatypes.py
-   25  arches/app/models/resource.py
-   22  arches/app/search/search_engine_factory.py
-   21  arches/app/views/api/__init__.py
-   18  arches/app/search/mappings.py
-   17  arches/app/search/components/base.py
-   16  arches/app/models/concept.py
-   16  arches/app/utils/decorators.py
