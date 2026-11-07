import { Column, Row, Text } from '@expo/ui/jetpack-compose';
import { background, fillMaxSize, paddingAll } from '@expo/ui/jetpack-compose/modifiers';
import { createWidget } from 'expo-widgets';

/** The home screen widget: what is due, today's goal and the streak. Self-contained, as the widget runtime requires. */
const StudyWidget = props => {
  'widget';
  const left = Math.max(0, props.goal - props.done);
  const goalLine = props.done >= props.goal ? 'Daily goal reached' : `${props.done}/${props.goal} today · ${left} to go`;
  return (
    <Column modifiers={[fillMaxSize(), background('#5a45e0'), paddingAll(14)]}>
      <Text color="#d9ccff" style={{ fontSize: 13, fontWeight: 'bold' }}>{props.brand}</Text>
      <Row>
        <Text color="#ffffff" style={{ fontSize: 40, fontWeight: 'bold' }}>{String(props.due)}</Text>
        <Text color="#e6dffa" style={{ fontSize: 14 }}>{props.due === 1 ? '  card due' : '  cards due'}</Text>
      </Row>
      <Text color="#ffffff" style={{ fontSize: 13 }}>{goalLine}</Text>
      <Text color="#ffd9a0" style={{ fontSize: 13 }}>{props.streak > 0 ? `${props.streak}-day streak` : 'Start a streak today'}</Text>
      <Text color="#cbbff5" style={{ fontSize: 11 }}>{props.updated ? `Updated ${props.updated}` : `Open ${props.brand} to update`}</Text>
    </Column>
  );
};

export default createWidget('StudyWidget', StudyWidget, { brand: '', due: 0, done: 0, goal: 20, streak: 0, updated: '' });
