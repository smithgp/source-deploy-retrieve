import { MetadataComponent } from '../types';
import { SimpleTransformer } from './transformers/simple';
import { MetadataTransformer } from './transformers';

function getTransformer(component: MetadataComponent): MetadataTransformer {
  // determine transformer to use from component's type
  return new SimpleTransformer();
}

// This just accepts a collection of MetadataComponents to convert. We might be able
// to squeeze some more performance out if we pipeline the registry inferencing with
// this operation. But that's an optimization to think about another time.
export async function convertSource(
  sourceFormat: MetadataComponent[],
  destination: string
): Promise<MetadataComponent[]> {
  const metadataFormat: MetadataComponent[] = [];
  for (const component of sourceFormat) {
    // this transformer is just writing to an fs writestream. ideally we could pass
    // in whatever WritableStream we want like a zip depending on the use case.
    const transformer = getTransformer(component);
    metadataFormat.push(await transformer.toApiFormat(component, destination));
  }
  // in addition to doing the conversion, we return the components in "metadata api format" pointing
  // to the new location. This doesn't actually work right now
  return metadataFormat;
}
