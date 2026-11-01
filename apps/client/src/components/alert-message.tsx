export function AlertMessage({ text }: { text: string }) {
  return (
    <p role='alert' className='bg-destructive/10 text-destructive rounded-md px-4 py-2.5 text-sm'>
      {text}
    </p>
  );
}
