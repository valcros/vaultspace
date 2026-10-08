#!/usr/bin/env python3
"""Read-only KQL validation using Azure's engine, synthetic cases and real ingestion.

Requires Azure CLI authentication with Log Analytics query access. Does not create
alerts, send notifications, retrieve credentials, or return raw application logs.
"""

import argparse
import json
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--subscription', required=True)
    parser.add_argument('--workspace', required=True, help='Log Analytics customer/workspace UUID')
    parser.add_argument('--workload', action='append', required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    template = json.loads((root / 'infrastructure/email-failure-alerts.json').read_text())
    fixtures = json.loads((root / 'infrastructure/email-failure-alerts.fixtures.json').read_text())
    variables = template['variables']

    def query(kql):
        result = subprocess.run(
            ['az', 'monitor', 'log-analytics', 'query', '--subscription', args.subscription,
             '--workspace', args.workspace, '--analytics-query', kql, '-o', 'json'],
            capture_output=True, text=True, check=True,
        )
        return json.loads(result.stdout)

    # Both app and job columns are exercised. Foreign workloads, old rows and
    # malformed JSON are negative controls. No synthetic rows are ingested.
    rows = []
    for index, case in enumerate(fixtures):
        job = case.get('component', '').endswith('reconciler')
        workload = case.get('workload', 'test-workload')
        payload = case.get('raw', json.dumps({key: case.get(key) for key in ('component', 'event', 'outcome')}))
        row = [str(index), str(case.get('ageSeconds', index)), json.dumps('' if job else workload),
               json.dumps(workload if job else ''), json.dumps(payload), json.dumps(case['expected'])]
        rows.append(','.join(row))
    fixture = (
        'let workloads=dynamic(["test-workload"]);\n'
        'let fixture=datatable(caseId:long, ageSeconds:long, ContainerAppName_s:string, '
        'ContainerJobName_s:string, Log_s:string, expected:string)[\n'
        + ',\n'.join(rows) + '\n] | extend TimeGenerated=now()-ageSeconds*1s;\n'
    )
    for label, predicate in [('mail', 'mailPredicate'), ('reconciler', 'reconcilerPredicate')]:
        detection = variables['sourceQuery'].replace('ContainerAppConsoleLogs_CL', 'fixture', 1)
        detection += variables[predicate]
        # Keep the actual parsing/filtering predicates, retain only fixture IDs
        # instead of the production privacy-preserving result projection.
        detection = detection.replace('| project TimeGenerated, component, event, outcome', '| project caseId')
        test_query = fixture + 'let detected=' + detection + ';\n' + (
            'fixture | join kind=leftouter (detected | extend matched=true) on caseId '
            f'| extend expectedMatch=expected=="{label}" '
            '| summarize cases=count(), mismatches=countif(expectedMatch != coalesce(matched,false))'
        )
        result = query(test_query)
        if len(result) != 1 or int(result[0]['cases']) != len(fixtures) or int(result[0]['mismatches']) != 0:
            raise RuntimeError(f'{label} KQL fixture validation failed: {result}')
        print(json.dumps({'test': label + ' fixtures', 'cases': len(fixtures), 'mismatches': 0}))
        empty = fixture + 'let empty=fixture | where false;\n'
        empty += detection.replace('fixture', 'empty', 1) + '\n| summarize matches=count()'
        empty_result = query(empty)
        if len(empty_result) != 1 or int(empty_result[0]['matches']) != 0:
            raise RuntimeError(f'{label} empty-window validation failed: {empty_result}')
        print(json.dumps({'test': label + ' empty window', 'matches': 0}))
        live = 'let workloads=dynamic(' + json.dumps(args.workload) + ');\n'
        live += variables['sourceQuery'] + variables[predicate] + '\n| summarize matches=count()'
        print(json.dumps({'test': label + ' live query', 'result': query(live)}))

    ingestion = 'let workloads=dynamic(' + json.dumps(args.workload) + ');\n'
    ingestion += variables['sourceQuery'].replace('ago(15m)', 'ago(1h)')
    ingestion += '| summarize rows=count(), parsed=countif(isnotempty(component)), latest=max(TimeGenerated)'
    print(json.dumps({'test': 'recent ingestion (not a delivery guarantee)', 'result': query(ingestion)}))


if __name__ == '__main__':
    main()
