import OpenAI from 'openai';
import { config } from './config.mjs';

let openaiClient = null;

/**
 * Returns a singleton instance of the OpenAI client if configured.
 * 
 * @returns {OpenAI|null} OpenAI client or null
 */
function getOpenAIClient() {
  if (!config.llm.apiKey) return null;
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: config.llm.apiKey,
      baseURL: config.llm.baseUrl,
    });
  }
  return openaiClient;
}

/**
 * Connects to an OpenAI-compatible completions endpoint (OpenRouter) to extract 
 * structured details from unstructured housing news alerts using Strict Structured Outputs.
 * 
 * @param {string} title - The news title
 * @param {string} summary - The news summary/snippet
 * @returns {Promise<Object>} The extracted fields (guaranteed to match the schema)
 */
export async function extractHousingData(title, summary) {
  const defaultData = {
    precioMin: null,
    precioMax: null,
    habitacionesMin: null,
    banosMin: null,
    promotora: null,
    totalViviendas: null,
    garaje: null,
    trastero: null,
    terraza: null,
  };

  const client = getOpenAIClient();
  if (!client) {
    return defaultData;
  }

  const systemPrompt = `Eres un asistente experto en el sector inmobiliario español. Tu tarea es extraer información estructurada a partir del título y el resumen de una noticia sobre promociones de vivienda, cooperativas o parcelas de suelo residencial en España.
Rellena cada uno de los campos requeridos en el objeto JSON de salida. Si un campo no se menciona en la noticia, asígnale el valor null.`;

  const userPrompt = `Noticia para analizar:
Título: ${title}
Resumen: ${summary}`;

  try {
    // Utilize OpenAI/OpenRouter strict structured outputs json_schema
    const response = await client.chat.completions.create({
      model: config.llm.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'extract_housing_details',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              precioMin: { 
                type: ['number', 'null'], 
                description: 'Precio mínimo de la promoción en euros. null si no se menciona.' 
              },
              precioMax: { 
                type: ['number', 'null'], 
                description: 'Precio máximo de la promoción en euros. null si no se menciona.' 
              },
              habitacionesMin: { 
                type: ['number', 'null'], 
                description: 'Número mínimo de habitaciones de los pisos. null si no se menciona.' 
              },
              banosMin: { 
                type: ['number', 'null'], 
                description: 'Número mínimo de baños de los pisos. null si no se menciona.' 
              },
              promotora: { 
                type: ['string', 'null'], 
                description: 'Nombre de la promotora, gestora de cooperativa o constructora. null si no se menciona.' 
              },
              totalViviendas: { 
                type: ['number', 'null'], 
                description: 'Número total de viviendas de la promoción. null si no se menciona.' 
              },
              garaje: { 
                type: ['boolean', 'null'], 
                description: 'true si se incluye garaje/aparcamiento, false si explícitamente se dice que no tiene, null si no se menciona.' 
              },
              trastero: { 
                type: ['boolean', 'null'], 
                description: 'true si se incluye trastero/bodega, false si explícitamente se dice que no tiene, null si no se menciona.' 
              },
              terraza: { 
                type: ['boolean', 'null'], 
                description: 'true si se incluye terraza, balcón, porche o jardín, false si explícitamente se dice que no tiene, null si no se menciona.' 
              }
            },
            required: [
              'precioMin', 
              'precioMax', 
              'habitacionesMin', 
              'banosMin', 
              'promotora', 
              'totalViviendas', 
              'garaje', 
              'trastero', 
              'terraza'
            ],
            additionalProperties: false
          }
        }
      }
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) return defaultData;

    const parsed = JSON.parse(content.trim());
    return parsed;
  } catch (error) {
    console.warn(`[llm] Fallo al extraer datos con LLM (Structured Output): ${error.message}`);
    return defaultData;
  }
}
