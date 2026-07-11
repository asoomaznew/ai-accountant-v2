const fs = require('fs');

// الأكواد الحقيقية المستخرجة من ملف الـ constants بتاع هيثم
const bankInfos = [
    { accountName: "AL ASEEL INTERNATIONAL POLYCLINIC", accountNo: "KIBAA-2380", activities: "1194", propertyId: "CLO3", departments: "113", projectId: "104" },
    { accountName: "IRIS POLYCLINIC", accountNo: "KIBIR-2282", activities: "1193", propertyId: "CLO3", departments: "113", projectId: "104" },
    { accountName: "YARROW POLYCLINIC", accountNo: "KIBYR-4765", activities: "1198", propertyId: "CLO3", departments: "113", projectId: "104" },
    { accountName: "FOURTH MEDICAL CENTER", accountNo: "KIBFR-8602", activities: "1195", propertyId: "CLO5", departments: "113", projectId: "104" },
    { accountName: "JOYA POLYCLINIC", accountNo: "KIBJY-2258", activities: "1197", propertyId: "CLO6", departments: "113", projectId: "104" }
];

const offsetMapping = {
    "KIBAA-2380": "50-000010",
    "KIBIR-2282": "50-000004",
    "KIBYR-4765": "50-000005",
    "KIBFR-8602": "50-000009",
    "KIBJY-2258": "50-000002"
};

const templates = [
    "كيف يتعامل السيستم مع عملية الرواتب لـ {clinic} حساب رقم {acc}؟",
    "اشرح توجيه القيد الناتج عن معاملات {clinic} في نظام Journal Entry Automation.",
    "ما هي الأبعاد المحاسبية المتأثرة عند رصد حركة على الحساب {acc}؟",
    "إذا وجد السيستم حركات محاسبية لـ {clinic} بمبلغ {amount}، كيف سيتم تصديرها للإكسيل؟"
];

const dataset = [];

for (let i = 0; i < 500; i++) {
    const bank = bankInfos[i % bankInfos.length];
    const template = templates[i % templates.length];
    const amount = (Math.random() * 3000 + 200).toFixed(3);
    const offset = offsetMapping[bank.accountNo];

    const prompt = template.replace('{clinic}', bank.accountName).replace('{acc}', bank.accountNo).replace('{amount}', amount);
    
    const response = `بناءً على كود التطبيق المطور بواسطة هيثم سليمان:\n` +
        `1. يتم استخراج الحركات ومطابقتها برقم الحساب ${bank.accountNo}.\n` +
        `2. الحساب المدين الرئيسي هو حساب البنك ${bank.accountNo}، والحساب الدائن (Offset) المربوط به هو ${offset}.\n` +
        `3. يتم حقن الأبعاد القياسية في السطر تلقائياً: (Activities: ${bank.activities}، Department: ${bank.departments}، Project: ${bank.projectId}، Property: ${bank.propertyId}).\n` +
        `4. النتيجة تظهر في جدول المعاينة بصيغة قيد يومية متزن وجاهز للتحميل كملف Excel للاستيراد المباشر في النظام المحاسبي.`;

    dataset.push(JSON.stringify({ prompt, response }));
}

fs.writeFileSync('real_dataset.jsonl', dataset.join('\n'));
console.log('تم توليد 500 سطر تدريبي حقيقي بنجاح في ملف real_dataset.jsonl!');
