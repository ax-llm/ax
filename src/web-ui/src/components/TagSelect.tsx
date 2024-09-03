import { X } from "lucide-react";

interface TagItemProps {
  label: string;
  onDeselect: () => void;
  onSelect: () => void;
}

// This component represents an individual tag that can be selected or deselected
export const TagItem = ({ label, onDeselect, onSelect }: TagItemProps) => {
  return (
    <div className="flex items-center gap-2 bg-gray-100 rounded-full px-3 py-1">
      <span className="text-sm font-medium" onClick={onSelect}>{label}</span>
      <button onClick={onDeselect}>
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

interface TagItemListProps {
  availableItems: string[];
  onSelectionChange: (selectedItems: string[]) => void;
  selectedItems: string[];
}

// This component manages a list of tags, similar to a multi-select dropdown
export const TagItemList = ({ availableItems, onSelectionChange, selectedItems }: TagItemListProps) => {
  // Function to select an item
  const handleSelect = (item: string) => {
    if (!selectedItems.includes(item)) {
      const updatedSelectedItems = [...selectedItems, item];
      onSelectionChange(updatedSelectedItems);
    }
  };

  // Function to deselect an item
  const handleDeselect = (item: string) => {
    const updatedSelectedItems = selectedItems.filter(selectedItem => selectedItem !== item);
    onSelectionChange(updatedSelectedItems);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {availableItems.map(item => (
        <TagItem
          key={item}
          label={item}
          onDeselect={() => handleDeselect(item)}
          onSelect={() => handleSelect(item)}
        />
      ))}
    </div>
  );
};