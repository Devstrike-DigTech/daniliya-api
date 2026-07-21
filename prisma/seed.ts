import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter } as never);

/**
 * Affiliate onboarding content, mirroring what the portals show today
 * (daniliya-web/src/lib/data.ts). Idempotent — safe to re-run.
 */

const TUTORIAL_STEPS = [
  {
    title: 'Welcome to Daniliya Affiliates',
    content:
      'What the programme is, who it is for, and what you can earn. You are paid a flat ₦10,000 for every confirmed book sale you drive — no tiers, no cap.',
  },
  {
    title: 'Your payment links explained',
    content:
      'You get a unique per-product payment link. Anyone who buys through your link is attributed to you automatically — you never have to chase anyone for credit.',
  },
  {
    title: 'How your commission works',
    content:
      'Every commission moves Pending → Confirmed → Disbursed. It is Confirmed once the order clears its return window, and Disbursed when it lands in your bank. A refunded order reverses the commission.',
  },
  {
    title: 'Sharing the right way',
    content:
      'Share on your WhatsApp status, socials and communities. Never spam DMs, impersonate Daniliya staff, or promise discounts that do not exist — that is grounds for suspension.',
  },
  {
    title: 'Getting paid every Monday',
    content:
      'Confirmed commissions are paid out every Monday to your verified bank account. Minimum payout is ₦5,000; anything below rolls over to the next week.',
  },
];

/** correctOption stores the option TEXT (not an index) so it survives reordering. */
const QUESTIONS = [
  {
    text: 'How often does Daniliya pay out affiliate commissions?',
    options: ['Daily', 'Every Friday', 'Every Monday', 'End of the Month'],
    correct: 'Every Monday',
  },
  {
    text: 'How much do you earn on each book sale you drive?',
    options: ['5% of the price', '₦10,000 flat', '₦5,000 flat', 'It varies by tier'],
    correct: '₦10,000 flat',
  },
  {
    text: 'What do you share with customers to get credited for a sale?',
    options: [
      'Just your name',
      'A screenshot of the product',
      'Your unique per-product payment link',
      'The Daniliya office address',
    ],
    correct: 'Your unique per-product payment link',
  },
  {
    text: 'What must you complete before your account is activated?',
    options: [
      "Nothing, it's instant",
      'KYC, the tutorial and this assessment',
      'A paid subscription',
      'Ten sales',
    ],
    correct: 'KYC, the tutorial and this assessment',
  },
  {
    text: 'Which documents are required for KYC?',
    options: [
      'Passport photo only',
      'A government-issued ID and your bank account details',
      'Just your email',
      'A utility bill',
    ],
    correct: 'A government-issued ID and your bank account details',
    explanation:
      'You upload a government-issued ID and add your payout account — we resolve the account name with your bank.',
  },
  {
    text: 'What is the order of the commission lifecycle?',
    options: [
      'Disbursed → Confirmed → Pending',
      'Pending → Confirmed → Disbursed',
      'Confirmed → Pending → Disbursed',
      'Pending → Disbursed → Confirmed',
    ],
    correct: 'Pending → Confirmed → Disbursed',
  },
  {
    text: 'What happens to your commission if a customer gets a refund?',
    options: [
      'Nothing, you keep it',
      'The related commission is reversed',
      'You pay a penalty',
      'Your account is closed',
    ],
    correct: 'The related commission is reversed',
  },
  {
    text: 'Is there a cap on how much you can earn?',
    options: [
      'Yes, ₦100,000 per month',
      'Yes, after 10 sales',
      'No, commission scales with your sales',
      'Only on weekends',
    ],
    correct: 'No, commission scales with your sales',
  },
  {
    text: 'Which is an acceptable way to share your link?',
    options: [
      "Spamming strangers' DMs",
      'Posting on your WhatsApp status and socials',
      'Impersonating Daniliya staff',
      'Promising fake discounts',
    ],
    correct: 'Posting on your WhatsApp status and socials',
  },
  {
    text: 'What pass mark do you need to activate your affiliate account?',
    options: ['40%', '50%', '60%', '80%'],
    correct: '60%',
  },
];

/** Platform catalogue (vendorId null = Daniliya-owned). Prices in naira. */
const PRODUCTS = [
  {
    slug: 'the-builders-handbook',
    title: "The Builder's Handbook",
    description: "Nigeria's #1 practical builder playbook — real numbers, real stories.",
    price: '50000.00',
    commissionRate: '0',
    stockQuantity: 999,
    category: 'Books',
    status: 'ACTIVE' as const,
  },
  {
    slug: 'the-daniliya-method',
    title: 'The Daniliya Method',
    description: 'The system behind consistent weekly earnings.',
    price: '5000.00',
    commissionRate: '0',
    stockQuantity: 999,
    category: 'Books',
    status: 'ACTIVE' as const,
  },
  {
    slug: 'starter-bundle',
    title: 'Affiliate Starter Bundle',
    description: 'Both books plus the quick-start guide.',
    price: '52500.00',
    commissionRate: '0',
    stockQuantity: 500,
    category: 'Bundles',
    status: 'ACTIVE' as const,
  },
  {
    slug: 'daniliya-tote',
    title: 'Daniliya Canvas Tote',
    description: 'Heavyweight branded tote bag.',
    price: '7500.00',
    commissionRate: '0',
    stockQuantity: 120,
    category: 'Merch',
    status: 'ACTIVE' as const,
  },
  {
    slug: 'home-sparkle-kit',
    title: 'Home Sparkle Kit (Large)',
    description: 'Complete home cleaning kit.',
    price: '24500.00',
    commissionRate: '0',
    stockQuantity: 68,
    category: 'Home',
    status: 'ACTIVE' as const,
  },
  {
    slug: 'draft-preview-product',
    title: 'Unreleased Product',
    description: 'Not yet published — should never appear in the public catalogue.',
    price: '1000.00',
    commissionRate: '0',
    stockQuantity: 10,
    category: 'Merch',
    status: 'DRAFT' as const,
  },
];

/** Service verticals shown on daniliya-web /services. */
const VERTICALS = [
  { slug: 'laundry', name: 'Laundry', description: 'Wash, dry and fold — picked up and delivered.', isActive: true },
  { slug: 'dry-cleaning', name: 'Dry Cleaning', description: 'Professional dry cleaning for delicate items.', isActive: false },
  { slug: 'interior-decoration', name: 'Interior Decoration', description: 'Transform your space with our designers.', isActive: true },
  { slug: 'construction', name: 'Construction', description: 'Build and renovation projects, managed end to end.', isActive: true },
];

async function main() {
  console.log('Seeding tutorial steps…');
  for (const [i, step] of TUTORIAL_STEPS.entries()) {
    const existing = await prisma.tutorialStep.findFirst({ where: { title: step.title } });
    if (existing) {
      await prisma.tutorialStep.update({
        where: { id: existing.id },
        data: { ...step, sortOrder: i, isPublished: true },
      });
    } else {
      await prisma.tutorialStep.create({
        data: { ...step, sortOrder: i, isPublished: true },
      });
    }
  }

  console.log('Seeding assessment questions…');
  for (const q of QUESTIONS) {
    const existing = await prisma.assessmentQuestion.findFirst({ where: { text: q.text } });
    const data = {
      text: q.text,
      options: q.options,
      correctOption: q.correct,
      explanation: q.explanation ?? null,
      isActive: true,
    };
    if (existing) {
      await prisma.assessmentQuestion.update({ where: { id: existing.id }, data });
    } else {
      await prisma.assessmentQuestion.create({ data });
    }
  }

  console.log('Seeding service verticals…');
  for (const [i, v] of VERTICALS.entries()) {
    await prisma.vertical.upsert({
      where: { slug: v.slug },
      create: { ...v, sortOrder: i },
      update: { ...v, sortOrder: i },
    });
  }

  // Demo catalogue products are dev-only fixtures. Never seed them by default —
  // production has real products and must not be polluted. Opt in explicitly
  // with SEED_DEMO_PRODUCTS=true for a local/dev catalogue.
  if (process.env.SEED_DEMO_PRODUCTS === 'true') {
    console.log('Seeding demo catalogue products…');
    for (const p of PRODUCTS) {
      await prisma.product.upsert({
        where: { slug: p.slug },
        create: p,
        update: p,
      });
    }
  } else {
    console.log('Skipping demo products (set SEED_DEMO_PRODUCTS=true to include).');
  }

  const steps = await prisma.tutorialStep.count();
  const questions = await prisma.assessmentQuestion.count();
  const verticals = await prisma.vertical.count();
  console.log(
    `Done — ${steps} tutorial steps, ${questions} assessment questions, ${verticals} service verticals.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
