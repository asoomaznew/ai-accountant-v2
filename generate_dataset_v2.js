import * as fs from 'fs';
import 'dotenv/config';
import { VertexAI } from '@google-cloud/vertexai';

// --- Extensive Data extracted from constants.ts and warbaConstants.ts ---
const clinics = [
    { name: "AL ASEEL INTERNATIONAL POLYCLINIC", kib_acc: "KIBAA-2380", warba_acc: "WTAA-61012", offset: "50-000010", propertyId: "CLO3", activities: "1194", dept: "113", proj: "104" },
    { name: "IRIS POLYCLINIC", kib_acc: "KIBIR-2282", warba_acc: "WRIR-73018", offset: "50-000004", propertyId: "CLO3", activities: "1193", dept: "113", proj: "104" },
    { name: "YARROW POLYCLINIC", kib_acc: "KIBYR-4765", warba_acc: "WRYR-67011", offset: "50-000005", propertyId: "CLO3", activities: "1198", dept: "113", proj: "104" },
    { name: "MEWL POLYCLINIC", kib_acc: "KIBML-6601", warba_acc: "KIBML-6601", offset: "50-000011", propertyId: "CLO4", activities: "1205", dept: "113", proj: "104" },
    { name: "FOURTH MEDICAL CENTER", kib_acc: "KIBFR-8602", warba_acc: "WRFM-55018", offset: "50-000009", propertyId: "CLO5", activities: "1195", dept: "113", proj: "104" }
];

async function generateDataset() {
    const dataset = [];
    
    // FIX 8: no hardcoded production project id; require it from the environment.
    const project = process.env.VERTEX_PROJECT_ID;
    const location = process.env.VERTEX_LOCATION || 'us-central1';
    if (!project) {
        throw new Error('VERTEX_PROJECT_ID is not set. Configure it in your environment (.env) before running.');
    }
    const vertexAI = new VertexAI({ project: project, location: location });

    console.log(`Generating dataset using Vertex AI (Gemini Pro) on project ${project}...`);

    const prompt = `أنت محاسب مالي خبير. قم بتوليد 50 قيد محاسبي متنوع ومعقد (حالات شاذة، تسويات، استرجاع مبالغ، عمولات بنكية) لعيادات طبية باللغة العربية.
استخدم هذه العيادات كمصادر:
${JSON.stringify(clinics, null, 2)}

كل قيد يجب أن يكون بصيغة JSON تحتوي على:
"prompt": "وصف المعاملة كما تظهر في كشف الحساب (مثل KNET payment, Refund, POS settlement) مع ذكر المبلغ"
"response": "تحليل القيد المحاسبي بالتفصيل يشمل الحساب المدين، الحساب الدائن، الوصف في القيد، والأبعاد المحاسبية (Property, Dept, Project)"

أرجع مصفوفة JSON فقط بدون أي نص إضافي (بدون markdown).`;

    try {
        const generativeModel = vertexAI.getGenerativeModel({
            model: 'gemini-1.5-pro-preview-0409', // Vertex AI uses specific versions
            generationConfig: {
                temperature: 0.8,
                responseMimeType: 'application/json'
            }
        });

        const resp = await generativeModel.generateContent(prompt);
        const text = resp.response.candidates[0].content.parts[0].text;
        
        // Clean JSON in case it returns markdown fences
        const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();

        let generated = [];
        try {
            generated = JSON.parse(cleanedText);
        } catch (parseError) {
            console.error("Failed to parse Vertex AI response as JSON:", cleanedText);
            throw parseError;
        }

        for (const item of generated) {
            dataset.push(JSON.stringify({ prompt: item.prompt, response: item.response }));
        }

        fs.writeFileSync('dataset.jsonl', dataset.join('\n') + '\n');
        console.log(`✅ Successfully generated ${dataset.length} dynamic items in dataset.jsonl`);
        
    } catch (error) {
        console.error("Failed to generate dataset via Vertex AI:", error);
    }
}

generateDataset();
