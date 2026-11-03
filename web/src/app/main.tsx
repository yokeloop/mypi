import '@mantine/core/styles.css';
import { createRoot } from 'react-dom/client';
import { MantineProvider, Text } from '@mantine/core';

createRoot(document.getElementById('root')!).render(
  <MantineProvider defaultColorScheme="auto">
    <Text>mypi</Text>
  </MantineProvider>,
);
