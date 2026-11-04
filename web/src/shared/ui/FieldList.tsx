import { Table } from '@mantine/core';

const cell = { overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' } as const;

export function FieldList({ rows }: { rows: [string, string][] }) {
  return (
    <Table>
      <Table.Tbody>
        {rows.map(([name, value]) => (
          <Table.Tr key={name}>
            <Table.Td style={cell} fw={500}>{name}</Table.Td>
            <Table.Td style={cell}>{value}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
