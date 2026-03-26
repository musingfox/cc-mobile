import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

type QuestionStepperProps = {
  total: number;
  currentIndex: number;
  onNext: () => void;
  onPrevious: () => void;
  children: ReactNode;
};

export default function QuestionStepper({
  total,
  currentIndex,
  onNext,
  onPrevious,
  children,
}: QuestionStepperProps) {
  if (total === 1) {
    return <>{children}</>;
  }

  return (
    <div className="question-stepper">
      <div className="stepper-progress">
        {currentIndex + 1} / {total}
      </div>
      {children}
      <div className="stepper-controls">
        <button
          type="button"
          className="permission-btn stepper-btn"
          onClick={onPrevious}
          disabled={currentIndex === 0}
        >
          <ChevronLeft size={16} />
          Previous
        </button>
        <button
          type="button"
          className="permission-btn stepper-btn"
          onClick={onNext}
          disabled={currentIndex === total - 1}
        >
          Next
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
