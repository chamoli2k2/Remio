import { HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { containerBackground, font, foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers';
import { createWidget } from 'expo-widgets';

/**
 * The home screen widget: what is due, today's goal and the streak. It runs in its own small
 * runtime, so everything it needs comes in through `props` and nothing outside this function is used.
 */
const StudyWidget = (props, environment) => {
  'widget';
  const small = environment.widgetFamily === 'systemSmall';
  const left = Math.max(0, props.goal - props.done);
  const goalLine = props.done >= props.goal ? 'Daily goal reached' : `${props.done}/${props.goal} today · ${left} to go`;
  return (
    <VStack alignment="leading" spacing={small ? 4 : 6} modifiers={[padding({ all: 4 }), containerBackground('#5a45e0', 'widget')]}>
      <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle('#d9ccff')]}>{props.brand}</Text>
      <HStack spacing={6}>
        <Text modifiers={[font({ size: small ? 38 : 46, weight: 'heavy' }), foregroundStyle('#ffffff')]}>{String(props.due)}</Text>
        <Text modifiers={[font({ size: 14, weight: 'medium' }), foregroundStyle('#e6dffa')]}>{props.due === 1 ? 'card due' : 'cards due'}</Text>
      </HStack>
      <Text modifiers={[font({ size: 13, weight: 'medium' }), foregroundStyle('#ffffff')]}>{goalLine}</Text>
      <Text modifiers={[font({ size: 13, weight: 'medium' }), foregroundStyle('#ffd9a0')]}>{props.streak > 0 ? `${props.streak}-day streak` : 'Start a streak today'}</Text>
      <Spacer />
      {small ? null : <Text modifiers={[font({ size: 11 }), foregroundStyle('#cbbff5')]}>{props.updated ? `Updated ${props.updated}` : `Open ${props.brand} to update`}</Text>}
    </VStack>
  );
};

export default createWidget('StudyWidget', StudyWidget, { brand: '', due: 0, done: 0, goal: 20, streak: 0, updated: '' });
